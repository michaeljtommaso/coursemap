/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { solveLayers } from "./engine";
import { verifyAssignment } from "./verify";
import { solve as solveChecked } from "./index";
import { rng, randomCourses, SUBJECTS, TAGS, type Rng } from "./search.testkit";
import type { Answers, CourseRule, DistCourse, Layer, Row, SolveInput } from "./types";

/**
 * Solver × checker cross-check (spec 019 D8): the two were written
 * independently from the contract, so every result the solver produces must
 * pass the checker untouched. Random layers exercise every row kind and flag
 * together; the real college fixtures run on random subsets of their plans'
 * boards. A failure here is either a solver green the checker can't prove or a
 * contract the two read differently — both are bugs.
 */

const SRC = { url: "https://catalog.cornell.edu/", anchor: "test" };
const tag = (t: string): CourseRule => ({ tag: [t] });

function randomRows(r: Rng, prefix: string): Row[] {
  const rows: Row[] = [];
  const base = (id: string) => ({ id: `${prefix}-${id}`, label: id, group: "G", source: SRC });
  if (r.chance(0.7)) rows.push({ ...base("seat"), kind: "seat", rule: tag(r.pick(TAGS)) });
  if (r.chance(0.7)) {
    rows.push({
      ...base("pool"),
      kind: "pool",
      rule: { anyOf: [tag(r.pick(TAGS)), tag(r.pick(TAGS))] },
      requiredCourses: r.int(1, 3),
      requiredCredits: r.int(0, 9),
      ...(r.chance(0.4) ? { maxPerSubject: r.int(1, 2) } : {}),
      ...(r.chance(0.4)
        ? { limits: [{ rule: { subject: [r.pick(SUBJECTS)] }, ...(r.chance(0.5) ? { minCourses: 1 } : { maxCourses: 1 }) }] }
        : {}),
    });
  }
  if (r.chance(0.7)) {
    const cats = TAGS.slice(0, r.int(2, 4)).map((t) => ({ id: t.toLowerCase(), label: t, rule: tag(t) }));
    const maxCats = r.int(1, 2);
    rows.push({
      ...base("dist"),
      kind: "distribution",
      categories: cats,
      requiredCourses: r.int(1, cats.length),
      minDistinctCategories: r.int(1, cats.length),
      maxCategoriesPerCourse: maxCats,
      ...(maxCats > 1 ? { maxDoubleCountCourses: r.int(0, 2) } : {}),
      ...(r.chance(0.3) ? { perCategory: { [cats[0].id]: { max: 1 } } } : {}),
      ...(r.chance(0.3) ? { maxPerSubject: r.int(1, 3) } : {}),
    });
  }
  if (r.chance(0.5)) {
    rows.push({ ...base("credits"), kind: "credits", rule: tag(r.pick(TAGS)), requiredCredits: r.int(3, 12), sameSubject: r.chance(0.5) });
  }
  if (r.chance(0.5)) {
    rows.push({
      ...base("any"),
      kind: "anyOf",
      ...(r.chance(0.5) ? { overlay: true } : {}),
      rows: [
        { ...base("any-a"), kind: "seat", rule: tag(r.pick(TAGS)) },
        { ...base("any-b"), kind: "pool", rule: tag(r.pick(TAGS)), requiredCourses: 2, requiredCredits: 6 },
      ],
    });
  }
  if (r.chance(0.4)) rows.push({ ...base("overlay"), kind: "pool", overlay: true, rule: tag(r.pick(TAGS)), requiredCourses: 2, requiredCredits: 0 });
  if (rows.length === 0) rows.push({ ...base("seat"), kind: "seat", rule: tag(r.pick(TAGS)) });
  return rows;
}

function randomInput(seed: number): SolveInput {
  const r = rng(seed);
  const collegeRows = randomRows(r, "c");
  if (r.chance(0.6)) {
    collegeRows.unshift({ id: "c-excl", label: "excl", group: "G", source: SRC, kind: "seat", exclusive: true, rule: tag(r.pick(TAGS)) });
  }
  const layers: Layer[] = [
    { id: "college", kind: "college", family: "cas", name: "C", catalogYear: "2026-27", rows: collegeRows },
    { id: "major", kind: "major", family: "cas", name: "M", catalogYear: "2026-27", programId: "p", rows: randomRows(r, "m") },
  ];
  const courses = randomCourses(r, r.int(4, 12));
  const waived = r.chance(0.2) ? [`major:${layers[1].rows[0].id}`] : [];
  return { layers, courses, ctx: { programId: "p" }, waived };
}

/** College + major + one or two "separate" concentrations (counting groups). */
function randomGroupInput(seed: number): SolveInput {
  const base = randomInput(seed);
  const r = rng(seed * 7919 + 13);
  const conc = (id: string): Layer => ({
    id: `p--${id}`,
    kind: "concentration",
    family: "cas",
    name: id,
    catalogYear: "2026-27",
    programId: "p",
    concentrationId: id,
    courseSharing: "separate",
    rows: randomRows(r, id),
  });
  const layers = [...base.layers, conc("x"), ...(r.chance(0.3) ? [conc("y")] : [])];
  return { ...base, layers, courses: randomCourses(r, r.int(6, 14)) };
}

describe("solver results always pass the independent checker", () => {
  it("200 random boards with separate concentrations (counting groups)", () => {
    const failures: string[] = [];
    let groupBlocks = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const input = randomGroupInput(seed);
      const result = solveLayers(input);
      const report = verifyAssignment(input, result);
      if (!report.ok) failures.push(`seed ${seed}: ${report.rejections.map((x) => `${x.layerId}:${x.rowId} ${x.reason}`).join("; ")}`);
      // Non-vacuous: solving the same layers as shared must sometimes reuse a
      // course across major and concentration, and the checker must refuse that
      // when the input says "separate".
      const shared = { ...input, layers: input.layers.map((l) => (l.kind === "concentration" ? { ...l, courseSharing: "shared" as const } : l)) };
      const sharedResult = solveLayers(shared);
      if (!verifyAssignment(input, sharedResult).ok) groupBlocks++;
    }
    expect(failures).toEqual([]);
    expect(groupBlocks).toBeGreaterThan(10);
  }, 30_000);

  it("400 random two-layer boards", () => {
    const failures: string[] = [];
    const statuses: Record<string, number> = {};
    for (let seed = 1; seed <= 400; seed++) {
      const input = randomInput(seed);
      const result = solveLayers(input);
      for (const l of result.layers) for (const row of l.rows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
      const report = verifyAssignment(input, result);
      if (!report.ok) failures.push(`seed ${seed}: ${report.rejections.map((x) => `${x.layerId}:${x.rowId} ${x.reason}`).join("; ")}`);
    }
    expect(failures).toEqual([]);
    // Non-vacuous: the boards produce every ordinary outcome, greens included.
    expect(statuses.met).toBeGreaterThan(300);
    expect(statuses.partial).toBeGreaterThan(50);
    expect(statuses.unmet).toBeGreaterThan(50);
  });

  it("college fixtures on random subsets of their plans' boards", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixtures = join(here, "fixtures");
    const layers = new Map<string, Layer>();
    for (const f of readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
      const layer = LayerSchema.parse(JSON.parse(readFileSync(join(fixtures, f), "utf8")));
      layers.set(layer.id, layer);
    }
    const plans = readdirSync(join(fixtures, "plans"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(fixtures, "plans", f), "utf8")) as {
        layers: string[];
        courses: DistCourse[];
        ctx: SolveInput["ctx"];
      });
    const r = rng(2026);
    const failures: string[] = [];
    for (const plan of plans) {
      for (let k = 0; k < 15; k++) {
        const courses = plan.courses.filter(() => r.chance(0.7));
        const input: SolveInput = { layers: plan.layers.map((id) => layers.get(id)!), courses, ctx: plan.ctx };
        const report = verifyAssignment(input, solveLayers(input));
        if (!report.ok) failures.push(`${plan.layers.join("+")} #${k}: ${report.rejections.map((x) => x.reason).join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Spec 020: answers are an engine input read by the one rule evaluator, so
 * the solver and the checker must agree on every board under every answer
 * set. The test layers use each answer-reading question type: a usedAs gate
 * on an exclusive row, approvedFor and courseCondition gates on major rows,
 * and a student fact, next to random competing rows.
 */
describe("solver results pass the checker with random answers (spec 020)", () => {
  const USED = "usedAs:college/fws";
  const APPROVED = "approvedFor:major/grad";
  const COND = "courseCondition:major/cond";
  const FACT = "studentFact:honorsProgram:X";
  const Q = { source: SRC, quote: "A sentence from the catalog." };

  function answersInput(seed: number): { input: SolveInput; answers: Answers } {
    const r = rng(seed * 104729 + 7);
    const college: Layer = {
      id: "college",
      kind: "college",
      family: "cas",
      name: "C",
      catalogYear: "2026-27",
      rows: [
        {
          id: "fws",
          kind: "pool",
          label: "fws",
          group: "G",
          source: SRC,
          exclusive: true,
          rule: { anyOf: [tag("A"), { allOf: [{ subject: ["X"] }, { answered: USED }] }] },
          requiredCourses: r.int(1, 2),
          requiredCredits: 0,
        },
        ...randomRows(r, "c"),
      ],
      questions: [{ ...Q, type: "usedAs", row: "fws", courses: { subject: ["X"] } }],
    };
    const major: Layer = {
      id: "major",
      kind: "major",
      family: "cas",
      name: "M",
      catalogYear: "2026-27",
      programId: "p",
      rows: [
        {
          id: "grad",
          kind: "pool",
          label: "grad",
          group: "G",
          source: SRC,
          rule: { allOf: [tag("B"), { answered: APPROVED }] },
          requiredCourses: r.int(1, 2),
          requiredCredits: 0,
        },
        { id: "cond", kind: "seat", label: "cond", group: "G", source: SRC, rule: { anyOf: [tag("C"), { allOf: [{ subject: ["Y"] }, { answered: COND }] }] } },
        { id: "fact", kind: "seat", label: "fact", group: "G", source: SRC, rule: { anyOf: [tag("D"), { allOf: [{ answered: FACT }, { subject: ["Z"] }] }] } },
        ...randomRows(r, "m"),
      ],
      questions: [
        { ...Q, type: "approvedFor", row: "grad", courses: tag("B"), approver: "advisor" },
        { ...Q, type: "courseCondition", row: "cond", courses: { subject: ["Y"] }, condition: "lifeScienceFocus" },
        { ...Q, type: "studentFact", fact: "honorsProgram", subject: "X" },
      ],
    };
    const courses = randomCourses(r, r.int(4, 12), 0.3);
    const marks: Answers["marks"] = {};
    const answer = () => (r.chance(0.5) ? "yes" : "no");
    for (const c of courses) {
      for (const ref of [USED, APPROVED, COND]) if (r.chance(0.6)) marks[`${ref}@${c.id}`] = answer();
    }
    const facts: Answers["facts"] = r.chance(0.7) ? { [FACT]: answer() } : {};
    return { input: { layers: [college, major], courses, ctx: { programId: "p" } }, answers: { marks, facts } };
  }

  it("300 random boards: no checker rejection, and answers do flip rows", () => {
    const failures: string[] = [];
    let flipped = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { input, answers } = answersInput(seed);
      const withAnswers: SolveInput = { ...input, answers };
      const result = solveChecked(withAnswers);
      if (result.verifyLog.length > 0) failures.push(`seed ${seed}: ${result.verifyLog.join("; ")}`);
      const report = verifyAssignment(withAnswers, solveLayers(withAnswers));
      if (!report.ok) failures.push(`seed ${seed} (unchecked solve): ${report.rejections.map((x) => x.reason).join("; ")}`);
      // Non-vacuous: the same board without answers scores differently.
      const strict = solveChecked(input);
      const statuses = (res: typeof result) => res.layers.flatMap((l) => l.rows.map((row) => `${l.layerId}:${row.rowId}=${row.status}`)).join(",");
      if (statuses(strict) !== statuses(result)) flipped++;
    }
    expect(failures).toEqual([]);
    expect(flipped).toBeGreaterThan(60);
  }, 30_000);

  it("absent answers give exactly today's result", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { input } = answersInput(seed);
      const a = solveLayers(input);
      const b = solveLayers({ ...input, answers: { marks: {}, facts: {} } });
      expect(b).toEqual(a);
    }
  });
});
