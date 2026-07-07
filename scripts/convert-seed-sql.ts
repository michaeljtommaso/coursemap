// scripts/convert-seed-sql.ts
// One-time mechanical conversion: scripts/legacy-sql/002_seed.sql INSERT data
// → scripts/seed-data/*.json (docs/specs/002 §4 step 1).
//
// Run: cd scripts && npx tsx convert-seed-sql.ts
//
// Parses each INSERT block with a small tuple tokenizer that respects quoted
// strings and nested (...) / ARRAY[...] / '{...}'::jsonb, so JSONB prereq trees
// survive intact. Emits camelCase-ready raw records; the seeder (seed-firestore.ts)
// does the final field renames + program-doc assembly.
//
// Validates counts against the spec's expected totals and dedupes slot_edges on
// (program, from, to, type) per the known re-run-seed dedup bug.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const SQL_PATH = resolve(__dirname, "./legacy-sql/002_seed.sql");
const OUT_DIR = resolve(__dirname, "seed-data");

const sql = readFileSync(SQL_PATH, "utf-8");

// ── Tuple tokenizer ──────────────────────────────────────────────────────────
// Splits the VALUES body of one INSERT into top-level ( ... ) tuples, then each
// tuple into comma-separated fields, honoring quotes and nesting depth.
function extractInsertBody(insertKeyword: string): string {
  const start = sql.indexOf(insertKeyword);
  if (start === -1) throw new Error(`INSERT not found: ${insertKeyword}`);
  const valuesIdx = sql.indexOf("VALUES", start);
  if (valuesIdx === -1) throw new Error(`VALUES not found after: ${insertKeyword}`);
  // Body runs until the terminating "ON CONFLICT" or ";" for this statement.
  const afterValues = valuesIdx + "VALUES".length;
  const onConflict = sql.indexOf("ON CONFLICT", afterValues);
  const semi = sql.indexOf(";", afterValues);
  let end = onConflict === -1 ? semi : Math.min(onConflict, semi === -1 ? Infinity : semi);
  if (end === -1 || end === Infinity) end = semi === -1 ? sql.length : semi;
  return sql.slice(afterValues, end);
}

function splitTopLevelTuples(body: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  let started = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        // SQL escapes a quote by doubling it.
        if (body[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      if (depth === 1) {
        started = true;
        cur = "";
        continue;
      }
    }
    if (ch === ")") {
      depth--;
      if (depth === 0 && started) {
        tuples.push(cur);
        cur = "";
        started = false;
        continue;
      }
    }
    if (started) cur += ch;
  }
  return tuples;
}

function splitFields(tuple: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      fields.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) fields.push(cur.trim());
  return fields;
}

// ── Field value parsers ──────────────────────────────────────────────────────
function parseScalar(raw: string): string | null {
  const v = raw.trim();
  if (v === "NULL" || v === "") return null;
  if (v.startsWith("'")) {
    // Strip surrounding quotes, un-double internal quotes.
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function parseNumber(raw: string): number {
  const v = parseScalar(raw);
  return v === null ? 0 : Number(v);
}

function parseArray(raw: string): string[] {
  // ARRAY['FA','SP']  or  '{}' style
  const v = raw.trim();
  const m = v.match(/ARRAY\[(.*)\]/s);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  return splitFields(inner).map((s) => parseScalar(s) ?? "");
}

function parseJsonb(raw: string): unknown {
  const v = raw.trim();
  if (v === "NULL") return null;
  // '...json...'::jsonb  → strip the ::jsonb cast, then the quotes.
  const cast = v.replace(/::jsonb\s*$/i, "").trim();
  const scalar = parseScalar(cast);
  if (scalar === null) return null;
  try {
    return JSON.parse(scalar);
  } catch (e) {
    throw new Error(`Failed to parse JSONB: ${scalar}\n${(e as Error).message}`);
  }
}

// ── 1. COURSES ───────────────────────────────────────────────────────────────
// (id, subject, number, title, credits_min, credits_max, offered, prereq_expr, coreq_expr)
type RawCourse = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  offered: string[];
  prereqExpr: unknown;
  coreqExpr: unknown;
};

function parseCourses(): RawCourse[] {
  const body = extractInsertBody("INSERT INTO courses");
  return splitTopLevelTuples(body).map((t) => {
    const f = splitFields(t);
    return {
      id: parseScalar(f[0])!,
      subject: parseScalar(f[1])!,
      number: parseScalar(f[2])!,
      title: parseScalar(f[3])!,
      creditsMin: parseNumber(f[4]),
      creditsMax: parseNumber(f[5]),
      offered: parseArray(f[6]),
      prereqExpr: parseJsonb(f[7]),
      coreqExpr: parseJsonb(f[8]),
    };
  });
}

// ── 2. ALIASES ───────────────────────────────────────────────────────────────
function parseAliases(): Record<string, string> {
  const body = extractInsertBody("INSERT INTO course_aliases");
  const out: Record<string, string> = {};
  for (const t of splitTopLevelTuples(body)) {
    const f = splitFields(t);
    out[parseScalar(f[0])!] = parseScalar(f[1])!;
  }
  return out;
}

// ── 3. PROGRAMS ──────────────────────────────────────────────────────────────
// (id, name, short_name, college, catalog_year, affiliation_text)
type RawProgram = {
  id: string;
  name: string;
  shortName: string;
  college: string;
  catalogYear: number;
  affiliationText: string | null;
};

function parsePrograms(): RawProgram[] {
  const body = extractInsertBody("INSERT INTO programs");
  return splitTopLevelTuples(body).map((t) => {
    const f = splitFields(t);
    return {
      id: parseScalar(f[0])!,
      name: parseScalar(f[1])!,
      shortName: parseScalar(f[2])!,
      college: parseScalar(f[3])!,
      catalogYear: parseNumber(f[4]),
      affiliationText: parseScalar(f[5]),
    };
  });
}

// ── 4. ELECTIVE GROUPS ───────────────────────────────────────────────────────
// (id, program_id, name, description, qualifying_rule, min_credits, advisor_approval, notes)
type RawGroup = {
  id: string;
  programId: string | null;
  name: string;
  description: string | null;
  qualifyingRule: unknown;
  minCredits: number;
  advisorApproval: boolean;
  notes: string | null;
};

function parseGroups(): RawGroup[] {
  const body = extractInsertBody("INSERT INTO elective_groups");
  return splitTopLevelTuples(body).map((t) => {
    const f = splitFields(t);
    return {
      id: parseScalar(f[0])!,
      programId: parseScalar(f[1]),
      name: parseScalar(f[2])!,
      description: parseScalar(f[3]),
      qualifyingRule: parseJsonb(f[4]),
      minCredits: parseNumber(f[5]),
      advisorApproval: parseScalar(f[6]) === "true",
      notes: parseScalar(f[7]),
    };
  });
}

// ── 5. ELECTIVE QUALIFICATIONS ───────────────────────────────────────────────
// (group_id, course_id) → { [groupId]: courseId[] }
function parseQualifications(): Record<string, string[]> {
  const body = extractInsertBody("INSERT INTO elective_qualifications");
  const out: Record<string, string[]> = {};
  for (const t of splitTopLevelTuples(body)) {
    const f = splitFields(t);
    const g = parseScalar(f[0])!;
    const c = parseScalar(f[1])!;
    (out[g] ??= []).push(c);
  }
  return out;
}

// ── 6. PROGRAM SLOTS ─────────────────────────────────────────────────────────
// (id, program_id, kind, course_id, pattern, pattern_title, elective_group_id, suggested_semester, slot_row)
type RawSlot = {
  id: string;
  programId: string;
  kind: string;
  courseId: string | null;
  pattern: string | null;
  patternTitle: string | null;
  electiveGroupId: string | null;
  suggestedSemester: number;
  slotRow: number;
};

function parseSlots(): RawSlot[] {
  const body = extractInsertBody("INSERT INTO program_slots");
  return splitTopLevelTuples(body).map((t) => {
    const f = splitFields(t);
    return {
      id: parseScalar(f[0])!,
      programId: parseScalar(f[1])!,
      kind: parseScalar(f[2])!,
      courseId: parseScalar(f[3]),
      pattern: parseScalar(f[4]),
      patternTitle: parseScalar(f[5]),
      electiveGroupId: parseScalar(f[6]),
      suggestedSemester: parseNumber(f[7]),
      slotRow: parseNumber(f[8]),
    };
  });
}

// ── 7. SLOT EDGES ────────────────────────────────────────────────────────────
// (program_id, from_slot, to_slot, edge_type)
type RawEdge = { programId: string; from: string; to: string; type: string };

function parseEdges(): { edges: RawEdge[]; rawCount: number } {
  const body = extractInsertBody("INSERT INTO slot_edges");
  const all = splitTopLevelTuples(body).map((t) => {
    const f = splitFields(t);
    return {
      programId: parseScalar(f[0])!,
      from: parseScalar(f[1])!,
      to: parseScalar(f[2])!,
      type: parseScalar(f[3])!,
    };
  });
  // Dedup on (program, from, to, type) per the known re-run-seed dedup bug.
  const seen = new Set<string>();
  const edges: RawEdge[] = [];
  for (const e of all) {
    const key = `${e.programId}|${e.from}|${e.to}|${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(e);
  }
  return { edges, rawCount: all.length };
}

// ── Run ──────────────────────────────────────────────────────────────────────
function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const courses = parseCourses();
  const aliases = parseAliases();
  const programs = parsePrograms();
  const groups = parseGroups();
  const qualifications = parseQualifications();
  const slots = parseSlots();
  const { edges, rawCount } = parseEdges();

  writeFileSync(resolve(OUT_DIR, "courses.json"), JSON.stringify(courses, null, 2));
  writeFileSync(resolve(OUT_DIR, "aliases.json"), JSON.stringify(aliases, null, 2));
  writeFileSync(resolve(OUT_DIR, "electiveGroups.json"), JSON.stringify(groups, null, 2));
  writeFileSync(
    resolve(OUT_DIR, "electiveQualifications.json"),
    JSON.stringify(qualifications, null, 2)
  );
  writeFileSync(resolve(OUT_DIR, "slots.json"), JSON.stringify(slots, null, 2));
  writeFileSync(resolve(OUT_DIR, "edges.json"), JSON.stringify(edges, null, 2));

  // Assemble a programs.json with nested slots/edges/groups so downstream tooling
  // and the acceptance check can see the whole doc shape (the seeder re-derives
  // from the atomic files, but this is the human-readable §4 artifact).
  const programsNested = programs.map((p) => {
    const pSlots = slots.filter((s) => s.programId === p.id);
    const pEdges = edges.filter((e) => e.programId === p.id);
    // Groups referenced by this program's slots: program-scoped + globals used.
    const referencedGroupIds = new Set(
      pSlots.map((s) => s.electiveGroupId).filter((x): x is string => !!x)
    );
    const pGroups = groups
      .filter((g) => g.programId === p.id || referencedGroupIds.has(g.id))
      .map((g) => ({ ...g, courseIds: qualifications[g.id] ?? [] }));
    return { ...p, electiveGroups: pGroups, slots: pSlots, edges: pEdges };
  });
  writeFileSync(
    resolve(OUT_DIR, "programs.json"),
    JSON.stringify(programsNested, null, 2)
  );

  // ── Count validation (docs/specs/002 §4) ──
  const expected = {
    courses: 50,
    aliases: 4,
    programs: 4,
    electiveGroups: 19,
    slots: 162,
    edges: 70,
  };
  const actual = {
    courses: courses.length,
    aliases: Object.keys(aliases).length,
    programs: programs.length,
    electiveGroups: groups.length,
    slots: slots.length,
    edges: edges.length,
  };

  console.log("── Seed conversion counts ──");
  let allMatch = true;
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    const ok = actual[key] === expected[key];
    if (!ok) allMatch = false;
    console.log(
      `  ${key.padEnd(16)} expected ${String(expected[key]).padStart(4)}  got ${String(
        actual[key]
      ).padStart(4)}  ${ok ? "OK" : "MISMATCH"}`
    );
  }
  console.log(`  edges raw (pre-dedup): ${rawCount}  → deduped ${edges.length}`);

  // Spot-check: CS-2110 prereq tree parses to a nested object.
  const cs2110 = courses.find((c) => c.id === "CS-2110");
  console.log("\n── Spot-check CS-2110.prereqExpr ──");
  console.log("  ", JSON.stringify(cs2110?.prereqExpr));

  console.log(`\nWrote 7 files to ${OUT_DIR}`);
  if (!allMatch) {
    console.error("\nCOUNT MISMATCH — investigate before seeding.");
    process.exit(1);
  }
  console.log("All counts match.");
}

main();
