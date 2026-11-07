// scripts/build-golden-plans.ts
// Build the golden (known-good) test plans for the 13 Engineering majors
// (spec 019 Phase 1, "Testing"). One fixture per major lands in
// seed-data/golden/<programId>.json; golden.test.ts in the app replays each plan
// through the real requirement path (schema parse → normalizer → matcher).
//
// Plans per major:
//   full            — one qualifying course for EVERY requirement slot. Each
//                     elective slot gets its own DISTINCT course, so a group
//                     with N slots carries N courses.
//   one-of-<group>  — the full plan minus all but ONE of that group's courses,
//                     for every group with more than one slot in the major.
//
// Inputs (read only):
//   - program definitions: seed-data/programs.json (the four 2026 majors) and
//     seed-data/programs-2025/*.json. Fixtures never copy the program; the test
//     reads it from seed-data, so later data fixes flow straight through.
//   - course data: a local catalog backup (scripts/backups/, gitignored). The
//     fixture keeps only the courses its plans use, trimmed to the fields the
//     matcher reads, so the test never needs the backup.
//
// Deterministic: candidates are tried in course-id order, and a rerun against
// the same inputs rewrites byte-identical files.
//
// Run: npx tsx build-golden-plans.ts [--backup <path>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import {
  matchesAttribute,
  normalizeAttributeMatch,
  patternToRegex,
  type AttributeMatch,
} from "../cornell-degree-planner/src/lib/planner/satisfies";

const SEED_DIR = resolve(__dirname, "seed-data");
const OUT_DIR = resolve(SEED_DIR, "golden");
const DEFAULT_BACKUP = resolve(__dirname, "backups", "catalog-backup-2026-10-18T17-22-10-228Z.json");

const backupIdx = process.argv.indexOf("--backup");
const BACKUP_PATH = backupIdx !== -1 ? resolve(process.argv[backupIdx + 1]) : DEFAULT_BACKUP;

/** The 13 Engineering majors. */
const PROGRAMS_2026 = ["cornell-cs-bs-2026", "cornell-ece-bs-2026", "cornell-me-bs-2026", "cornell-ore-bs-2026"];
const PROGRAMS_2025 = [
  "cornell-be-bs-2025",
  "cornell-bme-bs-2025",
  "cornell-ce-bs-2025",
  "cornell-cheme-bs-2025",
  "cornell-eas-bs-2025",
  "cornell-enve-bs-2025",
  "cornell-ep-bs-2025",
  "cornell-isst-bs-2025",
  "cornell-mse-bs-2025",
];

/** Matches the app's fallback for a course with no credit figure. */
const DEFAULT_COURSE_CREDITS = 3;

// ─── Input shapes ───────────────────────────────────────────────────────────

type Rule =
  | { type: "level"; subject: string; min_number: number; max_number?: number }
  | { type: "category"; category: string }
  | { type: "outside"; exclude_subjects: string[]; min_number?: number }
  | { type: "list" }
  | { type: "open"; min_number?: number; exclude_courses?: string[] };

type RawGroup = { id: string; name: string; qualifyingRule: Rule; minCredits: number; courseIds?: string[] };
type RawSlot = {
  id: string;
  kind: "course" | "pattern" | "elective" | "attribute";
  courseId?: string | null;
  pattern?: string | null;
  attributeMatch?: unknown;
  electiveGroupId?: string | null;
};
type RawProgram = { id: string; electiveGroups: RawGroup[]; slots: RawSlot[] };

type CourseAttr = { value: string; descr: string; group: string };
/** The trimmed course a fixture stores. */
type FixtureCourse = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  attrs: CourseAttr[];
};

type Gap = { requirementId: string; reason: string; needed: number; placed: number };
type Plan = { name: string; groupId?: string; courseIds: string[] };

// ─── Loading ────────────────────────────────────────────────────────────────

function loadPrograms(): RawProgram[] {
  const legacy = JSON.parse(readFileSync(resolve(SEED_DIR, "programs.json"), "utf-8")) as RawProgram[];
  const out: RawProgram[] = [];
  for (const id of PROGRAMS_2026) {
    const p = legacy.find((x) => x.id === id);
    if (!p) throw new Error(`program ${id} not found in seed-data/programs.json`);
    out.push(p);
  }
  for (const id of PROGRAMS_2025) {
    out.push(JSON.parse(readFileSync(resolve(SEED_DIR, "programs-2025", `${id}.json`), "utf-8")) as RawProgram);
  }
  return out;
}

function loadCatalog(path: string): Map<string, FixtureCourse> {
  if (!existsSync(path)) throw new Error(`catalog backup not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { courses?: Record<string, Record<string, unknown>> };
  if (!raw.courses) throw new Error("catalog backup has no `courses` map");
  const out = new Map<string, FixtureCourse>();
  for (const id of Object.keys(raw.courses).sort()) {
    const c = raw.courses[id];
    // Keep only the fields the matcher reads. Everything else (sections,
    // descriptions, roster metadata) is dropped on purpose.
    out.set(id, {
      id,
      subject: String(c.subject),
      number: String(c.number),
      title: String(c.title ?? id),
      creditsMin: Number(c.creditsMin ?? 0),
      creditsMax: Number(c.creditsMax ?? c.creditsMin ?? 0),
      attrs: Array.isArray(c.attrs)
        ? (c.attrs as CourseAttr[]).map((a) => ({ value: a.value, descr: a.descr, group: a.group }))
        : [],
    });
  }
  return out;
}

// ─── Rule helpers (same semantics as the app matcher, plus max_number) ─────

const credits = (c: FixtureCourse) => c.creditsMin || DEFAULT_COURSE_CREDITS;
const subjectOf = (id: string) => id.split("-")[0];

function levelQualifies(rule: Extract<Rule, { type: "level" }>, c: FixtureCourse): boolean {
  const num = parseInt(c.number, 10);
  if (c.subject !== rule.subject || Number.isNaN(num) || num < rule.min_number) return false;
  return rule.max_number == null || num <= rule.max_number;
}

// ─── Liberal studies (spec 037) ─────────────────────────────────────────────

type LsGroup = { id: string; bases: string[]; exact: string[] };
type LsCohort = { id: string; groups: LsGroup[] };
/** The Fall 2024 group table from the app's generated data module. */
const LS_GROUPS: LsGroup[] = (
  JSON.parse(
    readFileSync(resolve(__dirname, "..", "cornell-degree-planner", "src", "data", "liberal-studies", "2026-11-07.json"), "utf-8")
  ) as { cohorts: LsCohort[] }
).cohorts.find((c) => c.id === "fa2024")!.groups;

/** The liberal studies groups a course's roster tags put it in (Fall 2024 rules). */
function lsGroupsOf(c: FixtureCourse): string[] {
  const out = new Set<string>();
  for (const { value } of c.attrs) {
    const i = value.lastIndexOf("-");
    const base = i < 0 ? value : value.slice(0, i);
    for (const g of LS_GROUPS) if (g.bases.includes(base) || g.exact.includes(value)) out.add(g.id);
  }
  return [...out];
}

const isLiberalStudies = (rule: Rule) => rule.type === "category" && rule.category === "liberal-studies";

/** Does `c` qualify for group `g`? `list` uses the group's member ids (spec 019
 *  D7); a `category` other than liberal studies can't be decided from course data. */
function groupQualifies(g: RawGroup, c: FixtureCourse): boolean {
  const rule = g.qualifyingRule;
  switch (rule.type) {
    case "open":
      // spec 038: optional floor and named exclusions.
      if (rule.exclude_courses?.includes(c.id)) return false;
      return rule.min_number == null || parseInt(c.number, 10) >= rule.min_number;
    case "level":
      return levelQualifies(rule, c);
    case "outside":
      // spec 024: optional floor, e.g. CS External Specialization is 3000+ outside CS.
      if (rule.exclude_subjects.includes(c.subject)) return false;
      return rule.min_number == null || parseInt(c.number, 10) >= rule.min_number;
    case "list":
      return (g.courseIds ?? []).includes(c.id);
    case "category":
      return isLiberalStudies(rule) && lsGroupsOf(c).length > 0;
  }
}

// ─── Plan building ──────────────────────────────────────────────────────────

type MajorResult = {
  programId: string;
  slotCount: number;
  plans: Plan[];
  intent: Record<string, string[]>;
  gaps: Gap[];
  notes: string[];
  skippedPartials: { groupId: string; reason: string }[];
  greedyIssues: string[];
};

function buildMajor(program: RawProgram, catalog: Map<string, FixtureCourse>, sortedCourses: FixtureCourse[]): MajorResult {
  const used = new Set<string>();
  const gaps: Gap[] = [];
  const notes: string[] = [];
  const intent: Record<string, string[]> = {};
  const assign = (reqId: string, id: string) => {
    used.add(id);
    (intent[reqId] ??= []).push(id);
  };

  const groups = program.electiveGroups;
  const slotsByGroup = new Map<string, number>();
  for (const s of program.slots) {
    if (s.kind === "elective" && s.electiveGroupId) {
      slotsByGroup.set(s.electiveGroupId, (slotsByGroup.get(s.electiveGroupId) ?? 0) + 1);
    }
  }

  // Seat predicates, so pool picks can avoid courses that also fit a seat.
  const patternRes = program.slots.filter((s) => s.kind === "pattern" && s.pattern).map((s) => patternToRegex(s.pattern!));
  const attrMatches: AttributeMatch[] = program.slots
    .filter((s) => s.kind === "attribute")
    .map((s) => normalizeAttributeMatch(s.attributeMatch))
    .filter((m): m is AttributeMatch => m !== null);
  const fitsSeat = (c: FixtureCourse) =>
    patternRes.some((re) => re.test(`${c.subject} ${c.number}`)) ||
    attrMatches.some((m) => matchesAttribute({ title: c.title, attrValues: c.attrs.map((a) => a.value) }, m));
  const listMembers = new Set(groups.flatMap((g) => (g.qualifyingRule.type === "list" ? (g.courseIds ?? []) : [])));

  // Subjects this major names anywhere: a "neutral" course comes from none of them.
  const named = new Set<string>(["PE"]);
  for (const s of program.slots) {
    if (s.courseId) named.add(subjectOf(s.courseId));
    if (s.pattern) named.add(subjectOf(s.pattern));
  }
  for (const g of groups) {
    const r = g.qualifyingRule;
    if (r.type === "level") named.add(r.subject);
    if (r.type === "outside") r.exclude_subjects.forEach((x) => named.add(x));
    (g.courseIds ?? []).forEach((id) => named.add(subjectOf(id)));
  }
  const hasLs = groups.some((g) => isLiberalStudies(g.qualifyingRule) && (slotsByGroup.get(g.id) ?? 0) > 0);
  const neutral = sortedCourses.filter(
    (c) => !named.has(c.subject) && !fitsSeat(c) && !(hasLs && lsGroupsOf(c).length > 0)
  );

  /** First unused candidate by preference tier, then course id. */
  const pick = (cands: FixtureCourse[], tiers: ((c: FixtureCourse) => boolean)[]): FixtureCourse | null => {
    const free = cands.filter((c) => !used.has(c.id));
    for (const t of tiers) {
      const hit = free.find(t);
      if (hit) return hit;
    }
    return free[0] ?? null;
  };

  // 1. Course seats: the slot's own course.
  for (const s of program.slots) {
    if (s.kind !== "course" || !s.courseId) continue;
    if (!catalog.has(s.courseId)) {
      gaps.push({ requirementId: s.id, reason: `course ${s.courseId} is not in the catalog backup`, needed: 1, placed: 0 });
    } else if (used.has(s.courseId)) {
      gaps.push({ requirementId: s.id, reason: `course ${s.courseId} already fills another slot`, needed: 1, placed: 0 });
    } else {
      assign(s.id, s.courseId);
    }
  }

  // 2. Pattern and attribute seats: lowest matching number, 3+ credits, and
  //    preferably not a member of any of this major's course lists.
  for (const s of program.slots) {
    if (s.kind === "pattern" && s.pattern) {
      const re = patternToRegex(s.pattern);
      const cands = sortedCourses
        .filter((c) => re.test(`${c.subject} ${c.number}`))
        .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10) || a.id.localeCompare(b.id));
      const c = pick(cands, [(x) => x.creditsMin >= 3 && !listMembers.has(x.id), (x) => !listMembers.has(x.id)]);
      if (c) assign(s.id, c.id);
      else gaps.push({ requirementId: s.id, reason: `no catalog course matches pattern ${s.pattern}`, needed: 1, placed: 0 });
    } else if (s.kind === "attribute") {
      const m = normalizeAttributeMatch(s.attributeMatch);
      const cands = m
        ? sortedCourses.filter((c) => matchesAttribute({ title: c.title, attrValues: c.attrs.map((a) => a.value) }, m))
        : [];
      const c = pick(cands, [(x) => x.creditsMin >= 3 && !listMembers.has(x.id)]);
      if (c) assign(s.id, c.id);
      else gaps.push({ requirementId: s.id, reason: "no catalog course matches the attribute rule", needed: 1, placed: 0 });
    }
  }

  // 3. Elective groups, LAST group first. The matcher fills pools greedily in
  //    group order, richest course first, ties in board order. A group's own
  //    courses must out-rank any later group's course that also qualifies for
  //    it, so each pick aims for at least `floor` credits: the most credits of
  //    any already-chosen later-group course this group would also accept.
  const poolPicks = new Map<string, string[]>();
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    const n = slotsByGroup.get(g.id) ?? 0;
    if (n === 0) continue;
    const rule = g.qualifyingRule;
    if (rule.type === "category" && isLiberalStudies(rule)) {
      // spec 037: a set that meets the Fall 2024 rules on its own: one course
      // per group in the order below (Race & Equity first), single-group
      // courses preferred so each counts where it was picked, 3+ credits, the
      // first two at 2000+, never a seat or list course.
      const order = ["g7", "g1", "g4", "g2", "g3", "g5", "g6"];
      const ok = (c: FixtureCourse) =>
        !used.has(c.id) && c.creditsMin >= 3 && c.creditsMin <= 4 && !fitsSeat(c) && !listMembers.has(c.id) && !named.has(c.subject);
      const picks: string[] = [];
      for (const gid of order) {
        if (picks.length >= n) break;
        const upper = picks.length < 2;
        const inGroup = sortedCourses.filter((c) => ok(c) && lsGroupsOf(c).includes(gid));
        const c =
          inGroup.find((x) => lsGroupsOf(x).length === 1 && (!upper || parseInt(x.number, 10) >= 2000)) ??
          inGroup.find((x) => lsGroupsOf(x).length === 1) ??
          null;
        if (c) {
          assign(g.id, c.id);
          picks.push(c.id);
        }
      }
      if (picks.length < n) {
        gaps.push({ requirementId: g.id, reason: `only ${picks.length} liberal studies course(s) for ${n} slot(s)`, needed: n, placed: picks.length });
      }
      poolPicks.set(g.id, picks);
      continue;
    }
    if (rule.type === "category") {
      gaps.push({ requirementId: g.id, reason: `category rule (${rule.category}) can't be chosen from course data`, needed: n, placed: 0 });
      continue;
    }
    let floor = g.minCredits;
    for (const later of groups.slice(gi + 1)) {
      for (const id of poolPicks.get(later.id) ?? []) {
        const c = catalog.get(id)!;
        if (groupQualifies(g, c)) floor = Math.max(floor, credits(c));
      }
    }
    let cands: FixtureCourse[];
    if (rule.type === "list") {
      cands = (g.courseIds ?? []).map((id) => catalog.get(id)).filter((c): c is FixtureCourse => !!c);
      cands.sort((a, b) => a.id.localeCompare(b.id));
    } else if (rule.type === "level") {
      cands = sortedCourses.filter((c) => levelQualifies(rule, c));
    } else {
      // open / outside: a neutral course, so it fills nothing else by accident.
      cands = neutral.filter((c) => groupQualifies(g, c));
    }
    // A narrow (level/list) earlier group the candidate would also fit, where it
    // could be pulled. Broad earlier groups (open/outside) accept nearly
    // everything; the credit floor and board order keep them on their own picks.
    const broad = (e: RawGroup) => e.qualifyingRule.type === "open" || e.qualifyingRule.type === "outside";
    const fitsEarlier = (c: FixtureCourse) => groups.slice(0, gi).some((e) => !broad(e) && groupQualifies(e, c));
    const tiers = [
      (c: FixtureCourse) => c.creditsMin >= floor && c.creditsMin <= Math.max(floor, 4) && !fitsSeat(c) && !fitsEarlier(c),
      (c: FixtureCourse) => c.creditsMin >= floor && !fitsSeat(c) && !fitsEarlier(c),
      (c: FixtureCourse) => c.creditsMin >= floor && !fitsSeat(c),
      (c: FixtureCourse) => c.creditsMin >= floor,
      (c: FixtureCourse) => c.creditsMin >= g.minCredits,
    ];
    const picks: string[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const c = pick(cands, tiers);
      if (!c) break;
      assign(g.id, c.id);
      picks.push(c.id);
      sum += credits(c);
    }
    // Top up when the picks fall short of the group's credit total (a lecture
    // listed apart from its lab, e.g. a 3-credit lecture in a 4-credit slot):
    // add members until the total is reached, as a student would.
    const topUp: string[] = [];
    while (picks.length === n && sum < n * g.minCredits) {
      const c = pick(cands, []);
      if (!c) break;
      assign(g.id, c.id);
      picks.push(c.id);
      topUp.push(c.id);
      sum += credits(c);
    }
    if (topUp.length > 0) {
      notes.push(`${g.id}: ${n} slot(s) need ${n * g.minCredits} credits; added ${topUp.join(", ")} to reach ${sum}`);
    }
    if (picks.length >= n && sum < n * g.minCredits) {
      gaps.push({ requirementId: g.id, reason: `qualifying courses reach only ${sum} of ${n * g.minCredits} credits`, needed: n, placed: picks.length });
    }
    poolPicks.set(g.id, picks);
    if (picks.length < n) {
      const why =
        rule.type === "list"
          ? `list has ${(g.courseIds ?? []).length} member(s) for ${n} slot(s)`
          : `only ${picks.length} qualifying course(s) for ${n} slot(s)`;
      gaps.push({ requirementId: g.id, reason: why, needed: n, placed: picks.length });
    }
  }

  // Board order: seats in slot order, then pool courses in GROUP order, so a
  // credit tie between two pools resolves to the earlier group's own course.
  const seatIds = program.slots.filter((s) => s.kind !== "elective").flatMap((s) => intent[s.id] ?? []);
  const poolIds = groups.flatMap((g) => poolPicks.get(g.id) ?? []);
  const full: Plan = { name: "full", courseIds: [...seatIds, ...poolIds] };

  const plans: Plan[] = [full];
  const skippedPartials: MajorResult["skippedPartials"] = [];
  for (const g of groups) {
    const n = slotsByGroup.get(g.id) ?? 0;
    if (n <= 1) continue;
    const mine = poolPicks.get(g.id) ?? [];
    if (mine.length < 2) {
      skippedPartials.push({ groupId: g.id, reason: `${mine.length} course(s) placed, nothing to remove` });
      continue;
    }
    const drop = new Set(mine.slice(1));
    plans.push({ name: `one-of-${g.id}`, groupId: g.id, courseIds: full.courseIds.filter((id) => !drop.has(id)) });
  }

  gaps.sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  return {
    programId: program.id,
    slotCount: program.slots.length,
    plans,
    intent,
    gaps,
    notes,
    skippedPartials,
    greedyIssues: greedyCheck(groups, slotsByGroup, poolIds, poolPicks, catalog, new Set(gaps.map((x) => x.requirementId))),
  };
}

/**
 * Replay the pool phase the way spec 019 D6/D7 says it will work (target =
 * slots × minCredits AND slots courses; list rules computable), over the
 * pool courses only (seat courses are consumed first by the seat matching).
 * Reports any group that would end up with a course other than its own picks,
 * or short of its target (recorded gaps excepted).
 */
function greedyCheck(
  groups: RawGroup[],
  slotsByGroup: Map<string, number>,
  boardPoolIds: string[],
  poolPicks: Map<string, string[]>,
  catalog: Map<string, FixtureCourse>,
  gapIds: Set<string>
): string[] {
  const issues: string[] = [];
  const taken = new Set<string>();
  const board = boardPoolIds.map((id) => catalog.get(id)!);
  for (const g of groups) {
    const n = slotsByGroup.get(g.id) ?? 0;
    if (n === 0 || g.qualifyingRule.type === "category") continue;
    const cands = board.filter((c) => !taken.has(c.id) && groupQualifies(g, c));
    cands.sort((a, b) => credits(b) - credits(a)); // stable: ties keep board order
    const got: string[] = [];
    let sum = 0;
    for (const c of cands) {
      if (got.length >= n && sum >= n * g.minCredits) break;
      taken.add(c.id);
      got.push(c.id);
      sum += credits(c);
    }
    const own = new Set(poolPicks.get(g.id) ?? []);
    const foreign = got.filter((id) => !own.has(id));
    if (foreign.length > 0) issues.push(`${g.id} takes ${foreign.join(", ")}`);
    if (!gapIds.has(g.id) && (got.length < n || sum < n * g.minCredits)) issues.push(`${g.id} short (${got.length}/${n} courses, ${sum}/${n * g.minCredits} credits)`);
  }
  return issues;
}

// ─── Output ─────────────────────────────────────────────────────────────────

function main() {
  const catalog = loadCatalog(BACKUP_PATH);
  const sortedCourses = [...catalog.values()];
  mkdirSync(OUT_DIR, { recursive: true });

  const rows: string[][] = [["program", "slots", "placed", "partials", "gaps", "greedy check"]];
  const allNotes: string[] = [];
  for (const program of loadPrograms()) {
    const r = buildMajor(program, catalog, sortedCourses);
    const usedIds = [...new Set(r.plans.flatMap((p) => p.courseIds))].sort();
    const fixture = {
      programId: r.programId,
      generatedFrom: basename(BACKUP_PATH),
      generator: "scripts/build-golden-plans.ts",
      gaps: r.gaps,
      notes: r.notes,
      skippedPartials: r.skippedPartials,
      intent: r.intent,
      plans: r.plans,
      courses: usedIds.map((id) => catalog.get(id)!),
    };
    writeFileSync(resolve(OUT_DIR, `${r.programId}.json`), JSON.stringify(fixture, null, 2) + "\n");
    rows.push([
      r.programId,
      String(r.slotCount),
      String(r.plans[0].courseIds.length),
      String(r.plans.length - 1),
      r.gaps.map((g) => `${g.requirementId} (${g.placed}/${g.needed})`).join("; ") || "-",
      r.greedyIssues.join("; ") || "ok",
    ]);
    allNotes.push(...r.notes.map((n) => `${r.programId}  ${n}`));
  }

  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  if (allNotes.length > 0) console.log(`\nnotes:\n${allNotes.map((n) => `  ${n}`).join("\n")}`);
  console.log(`\nwrote ${rows.length - 1} fixtures to ${OUT_DIR}`);
}

main();
