import { describe, it, expect } from "vitest";
import { evaluateRow, makeEnv, relevantTo, type EvalRow, type Evaluation } from "./evaluateRow";
import { solveLayers } from "./engine";
import { evaluateStandaloneRow, solve } from "./index";
import { lintLayer } from "./lintLayer";
import { courseMatchesRule } from "./rules";
import { searchGroup } from "./search";
import { randomCourses, rng, subsets, TAGS, type Rng } from "./search.testkit";
import { verifyAssignment } from "./verify";
import { LayerSchema } from "@/lib/schemas";
import {
  subjectKey,
  type CountedCourse,
  type CourseRule,
  type DistCourse,
  type DistributionResult,
  type DistributionRow,
  type Layer,
  type RowLimit,
  type SolveInput,
} from "./types";

/**
 * Distribution rows with the optional credit and sub-limit terms (spec 037
 * D6): `requiredCredits`, `perCategory[id].minCredits` and `limits`, solved
 * jointly with the category choice. Brute-force cross-checks for the
 * evaluator and the layer search, the Engineering liberal studies shape,
 * the checker's re-proof of each new term, and evaluateStandaloneRow.
 */

const EPS = 1e-9;
const source = { url: "https://example.edu", anchor: "x" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const matches = (c: DistCourse, rule: CourseRule) => courseMatchesRule(c, rule);

// ─── Brute force: the evaluator ─────────────────────────────────────────────

function randomExtLimits(r: Rng, courses: DistCourse[]): RowLimit[] {
  return Array.from({ length: r.int(0, 2) }, () => {
    const rule: CourseRule = r.chance(0.5) ? { tag: [r.pick(TAGS)] } : { number: { min: 1000 + r.int(0, Math.max(0, courses.length - 1)) } };
    const lim: RowLimit = { rule };
    if (r.chance(0.4)) lim.minCourses = r.int(1, 2);
    if (r.chance(0.3)) lim.maxCourses = r.int(0, 2);
    if (r.chance(0.3)) lim.minCredits = r.int(1, 5);
    if (r.chance(0.2)) lim.maxCredits = r.int(2, 6);
    if (lim.minCourses == null && lim.maxCourses == null && lim.minCredits == null && lim.maxCredits == null) lim.minCourses = 1;
    return lim;
  });
}

function randomExtRow(r: Rng, courses: DistCourse[]): DistributionRow {
  const catIds = TAGS.filter(() => r.chance(0.8));
  if (catIds.length === 0) catIds.push("A");
  const perCategory: NonNullable<DistributionRow["perCategory"]> = {};
  for (const k of catIds) {
    if (r.chance(0.4)) {
      perCategory[k] = {
        ...(r.chance(0.3) ? { min: r.int(1, 2) } : {}),
        ...(r.chance(0.3) ? { max: r.int(0, 2) } : {}),
        ...(r.chance(0.6) ? { minCredits: r.int(1, 5) } : {}),
      };
    }
  }
  const maxCat = r.int(1, 2);
  return {
    id: "d",
    label: "d",
    group: "g",
    source,
    kind: "distribution",
    ...(r.chance(0.2) ? { rule: { not: { subject: ["Z"] } } } : {}),
    categories: catIds.map((id) => ({ id, label: id, rule: { tag: [id] } })),
    requiredCourses: r.int(0, 4),
    minDistinctCategories: r.int(0, catIds.length),
    ...(r.chance(0.7) ? { requiredCredits: r.int(0, 12) } : {}),
    perCategory,
    maxCategoriesPerCourse: maxCat,
    ...(maxCat > 1 && r.chance(0.5) ? { maxDoubleCountCourses: r.int(0, 1) } : {}),
    ...(r.chance(0.25) ? { maxPerSubject: r.int(1, 2) } : {}),
    limits: randomExtLimits(r, courses),
  };
}

/** The documented fraction / met / legality of one assignment (choice[j] = category indices of eligible course j). */
function judgeAssignment(row: DistributionRow, elig: DistCourse[], choice: number[][]) {
  const cats = row.categories;
  const counts = cats.map(() => 0);
  const catCred = cats.map(() => 0);
  const subj = new Map<string, number>();
  let doubles = 0;
  const counted: DistCourse[] = [];
  choice.forEach((ks, j) => {
    if (ks.length === 0) return;
    counted.push(elig[j]);
    for (const k of ks) {
      counts[k]++;
      catCred[k] += elig[j].credits;
    }
    if (ks.length > 1) doubles++;
    const key = subjectKey(elig[j].subject, row.subjectGroups);
    subj.set(key, (subj.get(key) ?? 0) + 1);
  });
  const minK = cats.map((c) => row.perCategory?.[c.id]?.min ?? 0);
  const maxK = cats.map((c) => row.perCategory?.[c.id]?.max ?? Infinity);
  const minCr = cats.map((c) => row.perCategory?.[c.id]?.minCredits ?? 0);
  const credits = sum(counted.map((c) => c.credits));
  let legal =
    counts.every((c, k) => c <= maxK[k]) &&
    doubles <= (row.maxDoubleCountCourses ?? Infinity) &&
    [...subj.values()].every((n) => n <= (row.maxPerSubject ?? Infinity));
  const parts: number[] = [];
  const covered = counts.filter((c) => c > 0).length;
  let met =
    counted.length >= row.requiredCourses &&
    covered >= row.minDistinctCategories &&
    minK.every((m, k) => counts[k] >= m) &&
    credits >= (row.requiredCredits ?? 0) - EPS &&
    minCr.every((m, k) => catCred[k] >= m - EPS);
  if (row.requiredCourses > 0) parts.push(Math.min(1, counted.length / row.requiredCourses));
  if (row.minDistinctCategories > 0) parts.push(Math.min(1, covered / row.minDistinctCategories));
  const sumMin = sum(minK);
  if (sumMin > 0) parts.push(sum(minK.map((m, k) => Math.min(m, counts[k]))) / sumMin);
  if ((row.requiredCredits ?? 0) > 0) parts.push(Math.min(1, credits / (row.requiredCredits as number)));
  minCr.forEach((m, k) => {
    if (m > 0) parts.push(Math.min(1, catCred[k] / m));
  });
  for (const lim of row.limits ?? []) {
    const hit = counted.filter((c) => matches(c, lim.rule));
    const n = hit.length;
    const cr = sum(hit.map((c) => c.credits));
    if (lim.maxCourses != null && n > lim.maxCourses) legal = false;
    if (lim.maxCredits != null && cr > lim.maxCredits + EPS) legal = false;
    if ((lim.minCourses ?? 0) > 0) parts.push(Math.min(1, n / (lim.minCourses as number)));
    if ((lim.minCredits ?? 0) > 0) parts.push(Math.min(1, cr / (lim.minCredits as number)));
    if (n < (lim.minCourses ?? 0) || cr < (lim.minCredits ?? 0) - EPS) met = false;
  }
  return { legal, met, n: counted.length, credits, counts, fraction: met ? 1 : parts.length ? sum(parts) / parts.length : 1 };
}

describe("distribution with credit and limit terms = brute force", () => {
  it("500 seeded instances: met, fraction, fewest courses, legal assignment", () => {
    const r = rng(53);
    for (let t = 0; t < 500; t++) {
      const courses = randomCourses(r, r.int(0, 6), 0.45);
      const row = randomExtRow(r, courses);
      const env = makeEnv(courses, {});
      const all = courses.map((_, i) => i);
      const ev = evaluateRow(row, { offered: all, all }, env);

      const maxCat = row.maxCategoriesPerCourse ?? 1;
      const elig = courses.filter((c) => !row.rule || matches(c, row.rule));
      const options = elig.map((c) =>
        subsets(row.categories.map((_, k) => k).filter((k) => matches(c, row.categories[k].rule))).filter((s) => s.length <= maxCat)
      );
      let bestF = -1;
      let bestN = Infinity;
      let anyMet = false;
      const walk = (j: number, choice: number[][]) => {
        if (j === elig.length) {
          const a = judgeAssignment(row, elig, choice);
          if (!a.legal) return;
          if (a.fraction > bestF + EPS) {
            bestF = a.fraction;
            bestN = a.n;
          } else if (a.fraction > bestF - EPS) bestN = Math.min(bestN, a.n);
          anyMet ||= a.met;
          return;
        }
        for (const o of options[j]) {
          choice.push(o);
          walk(j + 1, choice);
          choice.pop();
        }
      };
      walk(0, []);

      const reported = elig.map((c) => (ev.categories?.get(courses.indexOf(c)) ?? []).map((id) => row.categories.findIndex((k) => k.id === id)));
      const mine = judgeAssignment(row, elig, reported);
      const ctx = `case ${t}: ${JSON.stringify({ row, courses })}`;
      expect(ev.exact, ctx).toBe(true);
      expect(mine.legal, ctx).toBe(true);
      expect(ev.met, ctx).toBe(anyMet);
      expect(ev.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(mine.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(ev.counted.length, ctx).toBe(bestN);
      if (row.requiredCredits != null) {
        expect(ev.progress.creditsHave, ctx).toBeCloseTo(mine.credits, 9);
        expect(ev.progress.creditsNeed, ctx).toBe(row.requiredCredits);
      } else {
        expect(ev.progress.creditsNeed, ctx).toBeUndefined();
      }
    }
  });
});

// ─── Brute force: the layer search with extended rows ───────────────────────

const base = (id: string) => ({ id, label: id, group: "g", source });

function randomGroupRow(r: Rng, id: string, courses: DistCourse[]): EvalRow {
  const tags = TAGS.filter(() => r.chance(0.5));
  const rule = { tag: tags.length ? tags : [r.pick(TAGS)] };
  const kind = r.int(0, 2);
  if (kind === 0) return { ...base(id), kind: "seat", rule };
  if (kind === 1) return { ...base(id), kind: "pool", rule, requiredCourses: r.int(1, 2), requiredCredits: r.int(0, 6) };
  return {
    ...base(id),
    kind: "distribution",
    categories: TAGS.slice(0, 3).map((tg) => ({ id: tg, label: tg, rule: { tag: [tg] } })),
    requiredCourses: r.int(1, 3),
    minDistinctCategories: r.int(1, 3),
    requiredCredits: r.int(0, 9),
    perCategory: r.chance(0.5) ? { [r.pick(TAGS.slice(0, 3))]: { minCredits: r.int(1, 4) } } : {},
    maxCategoriesPerCourse: r.int(1, 2),
    limits: randomExtLimits(r, courses),
  };
}

function bruteForceGroup(rows: EvalRow[], courses: DistCourse[]) {
  const env = makeEnv(courses, {});
  const all = courses.map((_, i) => i);
  const memo = new Map<string, Evaluation>();
  const evalSet = (r: number, set: number[]) => {
    const key = `${r}:${set.join(",")}`;
    let ev = memo.get(key);
    if (!ev) {
      ev = evaluateRow(rows[r], { offered: set, all }, env);
      memo.set(key, ev);
    }
    return ev;
  };
  const options = all.map((c) => [-1, ...rows.map((_, r) => r).filter((r) => relevantTo(rows[r], c, env))]);
  let best = { met: -1, frac: -1 };
  const sets: number[][] = rows.map(() => []);
  const walk = (i: number) => {
    if (i === all.length) {
      let met = 0;
      let frac = 0;
      rows.forEach((_, r) => {
        const ev = evalSet(r, sets[r]);
        if (ev.met) met++;
        frac += ev.fraction;
      });
      if (met > best.met || (met === best.met && frac > best.frac + 1e-9)) best = { met, frac };
      return;
    }
    for (const r of options[i]) {
      if (r >= 0) sets[r].push(i);
      walk(i + 1);
      if (r >= 0) sets[r].pop();
    }
  };
  walk(0);
  return best;
}

describe("searchGroup with credit/limit distribution rows = exhaustive enumeration", () => {
  it("200 seeded instances (joint bounds always on)", () => {
    const r = rng(59);
    for (let t = 0; t < 200; t++) {
      const courses = randomCourses(r, r.int(2, 6), 0.5);
      const rows = Array.from({ length: r.int(2, 3) }, (_, k) => randomGroupRow(r, `r${k}`, courses));
      const env = makeEnv(courses, {});
      const out = searchGroup(rows, courses.map((_, i) => i), 200_000, env, undefined, undefined, 0);
      const want = bruteForceGroup(rows, courses);
      const ctx = `case ${t}: ${JSON.stringify({ rows, courses })}`;
      expect(out.capped, ctx).toBe(false);
      expect(out.evals.filter((e) => e.met).length, ctx).toBe(want.met);
      expect(out.evals.reduce((a, e) => a + e.fraction, 0), ctx).toBeCloseTo(want.frac, 9);
      const counted = out.evals.flatMap((e) => e.counted);
      expect(new Set(counted).size, ctx).toBe(counted.length);
    }
  });

  it("solve() re-proves every met claim on random two-row layers", () => {
    const r = rng(61);
    for (let t = 0; t < 100; t++) {
      const courses = randomCourses(r, r.int(2, 6), 0.5);
      const rows = Array.from({ length: 2 }, (_, k) => randomGroupRow(r, `r${k}`, courses));
      const layer: Layer = { id: "l", kind: "college", family: "cas", name: "l", catalogYear: "2026-27", rows };
      const input: SolveInput = { layers: [layer], courses, ctx: { programId: "p" } };
      const raw = solveLayers(input);
      const ctx = `case ${t}: ${JSON.stringify({ rows, courses })}`;
      expect(verifyAssignment(input, raw), ctx).toEqual({ ok: true, rejections: [] });
    }
  });
});

// ─── The Engineering liberal studies shape (spec 037) ───────────────────────

const GROUP_TAGS: [string, string][] = [
  ["g1", "LA"],
  ["g2", "HA"],
  ["g3", "KCM"],
  ["g4", "SBA"],
  ["g5", "FL"],
  ["g6", "CE"],
  ["g7", "RE"],
];

const LS: DistributionRow = {
  id: "liberal-studies",
  label: "Liberal studies",
  group: "Liberal studies",
  source: { url: "https://www.engineering.cornell.edu/", anchor: "Liberal studies" },
  kind: "distribution",
  categories: GROUP_TAGS.map(([id, tag]) => ({ id, label: id, rule: { tag: [tag] } })),
  requiredCourses: 6,
  requiredCredits: 18,
  minDistinctCategories: 3,
  maxCategoriesPerCourse: 1,
  perCategory: { g6: { max: 2 }, g7: { minCredits: 3 } },
  limits: [{ label: "2000-level or higher", rule: { number: { min: 2000 } }, minCourses: 2 }],
};

const lsCourse = (id: string, credits: number, ...tags: string[]): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: id, credits, attrs: tags.map((value) => ({ value })) };
};

/** The row evaluated alone over every course (the layer-free path). */
function evalLS(courses: DistCourse[], row: DistributionRow = LS) {
  const env = makeEnv(courses, {});
  const all = courses.map((_, i) => i);
  const ev = evaluateRow(row, { offered: all, all }, env);
  const catOf = new Map<string, string[]>();
  for (const i of ev.counted) catOf.set(courses[i].id, ev.categories?.get(i) ?? []);
  return { ev, ids: ev.counted.map((i) => courses[i].id), catOf };
}

const PASSING = [
  lsCourse("ENGL-1100", 3, "LA"),
  lsCourse("HIST-2000", 3, "HA"),
  lsCourse("PHIL-2100", 3, "KCM"),
  lsCourse("ECON-1110", 3, "SBA"),
  lsCourse("SPAN-1210", 4, "FL"),
  lsCourse("AAS-1100", 3, "RE"),
];

describe("liberal studies row (spec 037 D6)", () => {
  it("passes a board meeting every rule", () => {
    const { ev, ids } = evalLS(PASSING);
    expect(ev.met).toBe(true);
    expect(ev.fraction).toBe(1);
    expect(ids).toHaveLength(6);
    expect(ev.progress).toMatchObject({ coursesHave: 6, coursesNeed: 6, creditsHave: 19, creditsNeed: 18, missingCategories: [] });
  });

  it("six courses in two groups fail the groups, Group 7 and 2000-level rules", () => {
    const courses = [
      lsCourse("ENGL-1100", 3, "LA"),
      lsCourse("ENGL-1200", 3, "LA"),
      lsCourse("ENGL-1300", 3, "LA"),
      lsCourse("HIST-1100", 3, "HA"),
      lsCourse("HIST-1200", 3, "HA"),
      lsCourse("HIST-1300", 3, "HA"),
    ];
    const { ev } = evalLS(courses);
    expect(ev.met).toBe(false);
    expect(ev.counted).toHaveLength(6);
    expect(ev.progress.categoriesHave).toEqual(["g1", "g2"]);
    expect(ev.progress.creditsHave).toBe(18);
    // Missing: the uncovered groups (spread short) — g7 among them, also short on credits.
    expect(ev.progress.missingCategories).toEqual(["g3", "g4", "g5", "g6", "g7"]);
    // courses 1, groups 2/3, credits 1, g7 credits 0, 2000+ 0 → mean of five.
    expect(ev.fraction).toBeCloseTo((1 + 2 / 3 + 1 + 0 + 0) / 5, 9);
  });

  it("assigns a course tagged for Groups 2 and 7 to Group 7 when that is what passes", () => {
    const courses = [
      lsCourse("HIST-1540", 3, "HA", "RE"),
      lsCourse("ENGL-2100", 3, "LA"),
      lsCourse("HIST-2200", 3, "HA"),
      lsCourse("PHIL-1100", 3, "KCM"),
      lsCourse("ECON-1110", 3, "SBA"),
      lsCourse("SPAN-1210", 3, "FL"),
    ];
    const { ev, catOf } = evalLS(courses);
    expect(ev.met).toBe(true);
    expect(catOf.get("HIST-1540")).toEqual(["g7"]);
  });

  it("counts at most two Group 6 courses; a third is left out", () => {
    const courses = [
      lsCourse("COMM-2010", 3, "CE"),
      lsCourse("COMM-2020", 3, "CE"),
      lsCourse("COMM-1300", 3, "CE"),
      lsCourse("ENGL-2100", 3, "LA"),
      lsCourse("HIST-1200", 3, "HA"),
      lsCourse("AAS-1100", 3, "RE"),
      lsCourse("PHIL-1100", 3, "KCM"),
    ];
    const { ev, ids, catOf } = evalLS(courses);
    expect(ev.met).toBe(true);
    expect(ids).toHaveLength(6);
    const g6 = [...catOf.values()].filter((ks) => ks.includes("g6")).length;
    expect(g6).toBe(2);
    expect(["COMM-2010", "COMM-2020", "COMM-1300"].filter((id) => !ids.includes(id))).toHaveLength(1);

    // Without the seventh course only five can count: two CE + three others.
    const short = evalLS(courses.filter((c) => c.id !== "PHIL-1100"));
    expect(short.ev.met).toBe(false);
    expect(short.ev.counted).toHaveLength(5);
  });

  it("a 2-credit Group 7 course alone does not meet the 3-credit minimum", () => {
    const courses = [
      lsCourse("ENGL-2100", 3, "LA"),
      lsCourse("HIST-2200", 3, "HA"),
      lsCourse("PHIL-1100", 3, "KCM"),
      lsCourse("ECON-1110", 3, "SBA"),
      lsCourse("SPAN-1210", 4, "FL"),
      lsCourse("AAS-1100", 2, "RE"),
    ];
    const { ev } = evalLS(courses);
    expect(ev.met).toBe(false);
    expect(ev.progress.creditsHave).toBe(18);
    expect(ev.progress.missingCategories).toEqual(["g7"]);
    expect(ev.fraction).toBeCloseTo((1 + 1 + 1 + 2 / 3 + 1) / 5, 9);

    // A second 2-credit Group 7 course brings Group 7 to 4 credits.
    const two = evalLS([...courses, lsCourse("AAS-1200", 2, "RE")]);
    expect(two.ev.met).toBe(true);
    expect([...two.catOf.values()].filter((ks) => ks.includes("g7"))).toHaveLength(2);
  });

  it("reports a credit shortfall", () => {
    const courses = [
      lsCourse("ENGL-2100", 2, "LA"),
      lsCourse("HIST-2200", 2, "HA"),
      lsCourse("PHIL-1100", 2, "KCM"),
      lsCourse("ECON-1110", 2, "SBA"),
      lsCourse("SPAN-1210", 2, "FL"),
      lsCourse("AAS-1100", 3, "RE"),
    ];
    const { ev } = evalLS(courses);
    expect(ev.met).toBe(false);
    expect(ev.progress.creditsHave).toBe(13);
    expect(ev.progress.creditsNeed).toBe(18);
    expect(ev.progress.missingCategories).toEqual([]);
    expect(ev.fraction).toBeCloseTo((1 + 1 + 13 / 18 + 1 + 1) / 5, 9);
  });

  it("the fall 2020 – spring 2024 shape (no Group 7 minimum) passes without Group 7", () => {
    const older: DistributionRow = { ...LS, perCategory: { g6: { max: 2 } } };
    const courses = PASSING.filter((c) => c.id !== "AAS-1100").concat(lsCourse("ECON-2200", 3, "SBA"));
    expect(evalLS(courses, older).ev.met).toBe(true);
    expect(evalLS(courses).ev.met).toBe(false);
  });

  it("solves a full senior's board exactly within the budget", () => {
    // 16 tagged courses, many in two or three groups, none 2000-level: unmet,
    // so the search must prove the best partial result without a met cut-off.
    const tags = ["LA", "HA", "KCM", "SBA", "FL", "CE", "RE"];
    const courses = Array.from({ length: 16 }, (_, k) =>
      lsCourse(`SUBJ${k % 5}-${1100 + k}`, 3 + (k % 2), tags[k % 7], tags[(k * 3 + 1) % 7], ...(k % 3 === 0 ? [tags[(k + 4) % 7]] : []))
    );
    const { ev } = evalLS(courses);
    expect(ev.exact).toBe(true);
    expect(ev.met).toBe(false);
    // Add two 2000-level courses and it passes.
    const done = evalLS([...courses, lsCourse("HIST-2500", 3, "HA"), lsCourse("ENGL-2600", 3, "LA")]);
    expect(done.ev.exact).toBe(true);
    expect(done.ev.met).toBe(true);
  });

  it("rows without the new fields keep their exact progress shape (no credit figures)", () => {
    const { requiredCredits: _rc, limits: _l, ...rest } = LS;
    const plain: DistributionRow = { ...rest, perCategory: { g6: { max: 2 } } };
    const { ev } = evalLS(PASSING, plain);
    expect(ev.met).toBe(true);
    expect(Object.keys(ev.progress).sort()).toEqual(
      ["categoriesHave", "categoriesNeed", "coursesHave", "coursesNeed", "missingCategories"].sort()
    );
  });
});

// ─── The checker re-proves each new term ────────────────────────────────────

describe("verifyAssignment — distribution credit and limit terms", () => {
  const LAYER: Layer = { id: "eng", kind: "college", family: "cas", name: "Engineering", catalogYear: "2026-27", rows: [LS] };

  /** A hand-built result claiming `status` with these courses and categories. */
  function claim(courses: DistCourse[], counted: CountedCourse[], status: "met" | "partial" = "met") {
    const input: SolveInput = { layers: [LAYER], courses, ctx: { programId: "eng" } };
    const attribution: DistributionResult["attribution"] = {};
    for (const c of counted) attribution[c.courseId] = [{ layerId: "eng", rowId: LS.id }];
    const result: DistributionResult = {
      layers: [
        {
          layerId: "eng",
          kind: "college",
          name: "Engineering",
          rows: [
            {
              layerId: "eng",
              rowId: LS.id,
              kind: "distribution",
              label: LS.label,
              group: LS.group,
              status,
              courses: counted,
              progress: {},
              fraction: status === "met" ? 1 : 0.5,
            },
          ],
        },
      ],
      attribution,
      uncounted: courses.map((c) => c.id).filter((id) => !attribution[id]),
      pct: 0,
      nodes: 0,
      capped: false,
      verifyLog: [],
    };
    return verifyAssignment(input, result);
  }
  const groupOf: Record<string, string> = Object.fromEntries(GROUP_TAGS.map(([g, t]) => [t, g]));
  const asCounted = (courses: DistCourse[]) =>
    courses.map((c) => ({ courseId: c.id, credits: c.credits, categories: [groupOf[(c.attrs ?? [])[0].value]] }));
  const reasons = (report: ReturnType<typeof verifyAssignment>) => report.rejections.map((r) => r.reason);

  it("accepts a true met claim", () => {
    expect(claim(PASSING, asCounted(PASSING))).toEqual({ ok: true, rejections: [] });
  });

  it("rejects met when the counted credits fall short of requiredCredits", () => {
    const courses = PASSING.map((c) => (c.id === "SPAN-1210" ? { ...c, credits: 2 } : c)); // 17 credits
    const report = claim(courses, asCounted(courses));
    expect(report.ok).toBe(false);
    expect(reasons(report).some((r) => r.includes("counts 17 of 18 required credits"))).toBe(true);
  });

  it("rejects met when a category is short of its minCredits", () => {
    const courses = PASSING.map((c) => (c.id === "AAS-1100" ? { ...c, credits: 2 } : c)).concat(lsCourse("MATH-1100", 3, "LA"));
    const report = claim(courses, asCounted(courses));
    expect(report.ok).toBe(false);
    expect(reasons(report).some((r) => r.includes("category g7 has 2 credits (min 3)"))).toBe(true);
  });

  it("rejects met when a limit minimum fails over the counted courses", () => {
    const courses = PASSING.map((c) => ({ ...c, number: c.number.replace(/^2/, "1"), id: c.id.replace("-2", "-1") }));
    const report = claim(courses, asCounted(courses));
    expect(report.ok).toBe(false);
    expect(reasons(report).some((r) => r.includes('limit "2000-level or higher" needs at least 2 courses, has 0'))).toBe(true);
  });

  it("does not let one course supply two categories when the row allows one per course", () => {
    const courses = [
      lsCourse("HIST-1540", 3, "HA", "RE"),
      lsCourse("ENGL-2100", 3, "LA"),
      lsCourse("PHIL-2100", 3, "KCM"),
      lsCourse("ECON-1110", 3, "SBA"),
      lsCourse("SPAN-1210", 3, "FL"),
      lsCourse("ECON-1120", 3, "SBA"),
    ];
    const counted = asCounted(courses).map((c) => (c.courseId === "HIST-1540" ? { ...c, categories: ["g2", "g7"] } : c));
    const report = claim(courses, counted);
    expect(report.ok).toBe(false);
    expect(reasons(report).some((r) => r.includes("fills 2 categories (max 1 per course)"))).toBe(true);
  });

  it("the engine downgrades a tampered met claim to unchecked", () => {
    const input: SolveInput = { layers: [LAYER], courses: PASSING, ctx: { programId: "eng" } };
    const result = solveLayers(input, {
      verify: (i, r) => {
        r.layers[0].rows[0].courses = r.layers[0].rows[0].courses.filter((c) => c.courseId !== "AAS-1100");
        return verifyAssignment(i, r);
      },
    });
    expect(result.layers[0].rows[0].status).toBe("unchecked");
    expect(result.layers[0].rows[0].progress).toEqual({ coursesNeed: 6, creditsNeed: 18, categoriesNeed: 3 });
  });

  it("solve() keeps an honest liberal studies result", () => {
    const result = solve({ layers: [LAYER], courses: PASSING, ctx: { programId: "eng" } });
    expect(result.verifyLog).toEqual([]);
    expect(result.layers[0].rows[0].status).toBe("met");
    expect(result.layers[0].rows[0].progress).toMatchObject({ creditsHave: 19, creditsNeed: 18 });
  });
});

// ─── evaluateStandaloneRow (contract C1) ────────────────────────────────────

describe("evaluateStandaloneRow", () => {
  it("a passing board: counted set, categories and figures", () => {
    const out = evaluateStandaloneRow(LS, PASSING);
    expect(out.status).toBe("met");
    expect(out.counted).toEqual(PASSING.map((c) => c.id));
    expect(out.categoryOf).toEqual({
      "ENGL-1100": "g1",
      "HIST-2000": "g2",
      "PHIL-2100": "g3",
      "ECON-1110": "g4",
      "SPAN-1210": "g5",
      "AAS-1100": "g7",
    });
    expect(out.categoriesHave).toEqual(["g1", "g2", "g3", "g4", "g5", "g7"]);
    expect(out.missingCategories).toEqual([]);
    expect(out).toMatchObject({ coursesHave: 6, coursesNeed: 6, creditsHave: 19, creditsNeed: 18, fraction: 1, proven: true });
  });

  it("picks Group 7 for a Group 2 / Group 7 course", () => {
    const courses = [
      lsCourse("HIST-1540", 3, "HA", "RE"),
      lsCourse("ENGL-2100", 3, "LA"),
      lsCourse("HIST-2200", 3, "HA"),
      lsCourse("PHIL-1100", 3, "KCM"),
      lsCourse("ECON-1110", 3, "SBA"),
      lsCourse("SPAN-1210", 3, "FL"),
    ];
    const out = evaluateStandaloneRow(LS, courses);
    expect(out.status).toBe("met");
    expect(out.categoryOf["HIST-1540"]).toBe("g7");
  });

  it("an unfinished board: partial with missing categories and credits", () => {
    const out = evaluateStandaloneRow(LS, [lsCourse("ENGL-1100", 3, "LA"), lsCourse("HIST-2000", 4, "HA"), lsCourse("CS-1110", 4)]);
    expect(out.status).toBe("partial");
    expect(out.counted).toEqual(["ENGL-1100", "HIST-2000"]);
    expect(out.categoriesHave).toEqual(["g1", "g2"]);
    expect(out.missingCategories).toEqual(["g3", "g4", "g5", "g6", "g7"]);
    expect(out).toMatchObject({ coursesHave: 2, coursesNeed: 6, creditsHave: 7, creditsNeed: 18, proven: true });
    expect(out.fraction).toBeGreaterThan(0);
    expect(out.fraction).toBeLessThan(1);
  });

  it("nothing countable: unmet", () => {
    const out = evaluateStandaloneRow(LS, [lsCourse("CS-1110", 4)]);
    expect(out.status).toBe("unmet");
    expect(out.counted).toEqual([]);
    expect(out.fraction).toBe(0);
    // Proven unmet, not a search that gave up.
    expect(out.proven).toBe(true);
  });

  it("counts fewer than all when more courses than needed qualify, and canonicalizes ids", () => {
    const extra = [...PASSING, lsCourse("ENGL-2900", 3, "LA"), lsCourse("GOVT-1111", 3, "SBA")];
    const out = evaluateStandaloneRow(LS, extra, { canonical: (id) => (id === "GOVT-1111" ? "ECON-1110" : id) });
    expect(out.status).toBe("met");
    expect(out.counted).toHaveLength(6);
    expect(new Set(out.counted).size).toBe(6);
  });

  it("creditsNeed is 0 for a row without requiredCredits", () => {
    const { requiredCredits: _rc, ...rest } = LS;
    const out = evaluateStandaloneRow(rest, PASSING);
    expect(out.creditsNeed).toBe(0);
    expect(out.creditsHave).toBe(19);
  });

  it("ignores the row's own appliesTo", () => {
    const out = evaluateStandaloneRow({ ...LS, appliesTo: [{ enteredFrom: "FA24" }] }, PASSING);
    expect(out.status).toBe("met");
  });
});

// ─── Schema and lint accept the new fields ──────────────────────────────────

describe("layer schema and lint — distribution credit and limit terms", () => {
  const layer = (row: DistributionRow): Layer => ({
    id: "eng-liberal-studies",
    kind: "college",
    family: "cas",
    name: "Engineering",
    catalogYear: "2026-27",
    rows: [row],
  });

  it("the schema accepts requiredCredits, minCredits and limits", () => {
    expect(LayerSchema.safeParse(layer(LS)).success).toBe(true);
    expect(lintLayer(layer(LS))).toEqual([]);
  });

  it("the schema rejects negative credit figures and malformed limits", () => {
    expect(LayerSchema.safeParse(layer({ ...LS, requiredCredits: -1 })).success).toBe(false);
    expect(LayerSchema.safeParse(layer({ ...LS, perCategory: { g7: { minCredits: -3 } } })).success).toBe(false);
    expect(LayerSchema.safeParse(layer({ ...LS, limits: [{ rule: { tag: ["X"] }, minCourses: 1.5 }] })).success).toBe(false);
    expect(
      LayerSchema.safeParse(layer({ ...LS, limits: [{ rule: { tag: ["X"] }, minCourses: 1, extra: 1 } as unknown as RowLimit] })).success
    ).toBe(false);
  });

  it("lint checks distribution limits like pool limits", () => {
    const errs = lintLayer(layer({ ...LS, limits: [{ rule: { tag: ["X"] } }] }));
    expect(errs.some((e) => e.includes("sets no bound"))).toBe(true);
    const inverted = lintLayer(layer({ ...LS, limits: [{ rule: { tag: ["X"] }, minCourses: 3, maxCourses: 1 }] }));
    expect(inverted.some((e) => e.includes("minCourses > maxCourses"))).toBe(true);
  });

  it("lint flags a credit minimum on a category that allows no course", () => {
    const errs = lintLayer(layer({ ...LS, perCategory: { g6: { max: 0, minCredits: 3 } } }));
    expect(errs.some((e) => e.includes("needs credits but allows no course"))).toBe(true);
  });
});
