/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { solve } from "../distribution";
import { lintLayer } from "../distribution/lintLayer";
import { openQuestions } from "./openQuestions";
import { applyCourseMarks } from "./applyCourseMarks";
import type { DistCourse, DistributionResult, Layer, PoolRow, Question, SolveInput } from "../distribution/types";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = { url: "https://catalog.cornell.edu/arts-sciences/", anchor: "College of Arts and Sciences Graduation Requirements" };
const FWS_REF = "usedAs:cas-college/fws";

/** The real CAS college layer, with a TEST-ONLY copy of the FWS row that
 *  counts ENGL 2860 / 2880 only when the student says they are using it as a
 *  writing seminar (the real fixture is not edited here). */
function casWithFwsQuestion(): Layer {
  const raw = JSON.parse(readFileSync(join(here, "../distribution/fixtures/cas-college.json"), "utf8"));
  const layer = LayerSchema.parse(raw) as Layer;
  const question: Question = {
    type: "usedAs",
    row: "fws",
    courses: { course: ["ENGL-2860", "ENGL-2880"] },
    source: SRC,
    quote: "If counted toward the First-Year Writing Seminar requirement, the course will not count toward ALC-AS.",
  };
  const rows = layer.rows.map((row) =>
    row.id === "fws"
      ? ({
          ...row,
          rule: {
            anyOf: [{ titleStartsWith: "FWS:" }, { allOf: [{ course: ["ENGL-2860", "ENGL-2880"] }, { answered: FWS_REF }] }],
          },
        } as PoolRow)
      : row
  );
  return { ...layer, rows, questions: [question] };
}

const course = (id: string, over: Partial<DistCourse> = {}): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits: 3, ...over };
};

const fwsCourse = course("WRIT-1370", { title: "FWS: Writing About Place", attrs: [{ value: "ALC-AS" }] });
const engl2880 = course("ENGL-2880", { title: "Expository Writing", attrs: [{ value: "ALC-AS" }] });

function counting(solveFn: (i: SolveInput) => DistributionResult) {
  let calls = 0;
  return {
    solve: (i: SolveInput) => {
      calls++;
      return solveFn(i);
    },
    calls: () => calls,
  };
}

const row = (r: DistributionResult, layerId: string, rowId: string) =>
  r.layers.find((l) => l.layerId === layerId)!.rows.find((x) => x.rowId === rowId)!;

describe("openQuestions — the ENGL 2880 writing-seminar case (real CAS layer)", () => {
  const cas = casWithFwsQuestion();
  const input: SolveInput = {
    layers: [cas],
    courses: [fwsCourse, engl2880, course("HIST-1530", { attrs: [{ value: "HST-AS" }] })],
    ctx: { programId: "cornell-history-ba", entryTerm: "FA25", transfer: "none" },
  };

  it("the test layer lints clean and parses", () => {
    expect(lintLayer(cas)).toEqual([]);
    expect(LayerSchema.safeParse(cas).success).toBe(true);
  });

  it("asks exactly one question, on cas-college/fws, about ENGL 2880", () => {
    const current = solve(input);
    expect(row(current, "cas-college", "fws").status).toBe("partial");
    const open = openQuestions(input, current, solve);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      key: `${FWS_REF}@ENGL-2880`,
      ref: FWS_REF,
      layerId: "cas-college",
      courseId: "ENGL-2880",
      rowIds: ["fws"],
    });
    expect(open[0].question.type).toBe("usedAs");
  });

  it("after yes: the FWS row is met and ENGL 2880 leaves the distribution row", () => {
    const before = solve(input);
    expect(row(before, "cas-college", "distribution").courses.map((c) => c.courseId)).toContain("ENGL-2880");

    const answered: SolveInput = { ...input, answers: { marks: { [`${FWS_REF}@ENGL-2880`]: "yes" }, facts: {} } };
    const after = solve(answered);
    expect(after.verifyLog).toEqual([]);
    expect(row(after, "cas-college", "fws").status).toBe("met");
    expect(row(after, "cas-college", "fws").courses.map((c) => c.courseId)).toEqual(["WRIT-1370", "ENGL-2880"]);
    expect(row(after, "cas-college", "distribution").courses.map((c) => c.courseId)).not.toContain("ENGL-2880");
    expect(after.attribution["ENGL-2880"].map((a) => a.rowId)).not.toContain("distribution");
    // Answered: no longer an open question.
    expect(openQuestions(answered, after, solve)).toEqual([]);
  });

  it("an answer of no keeps the strict result and closes the question", () => {
    const answered: SolveInput = { ...input, answers: { marks: { [`${FWS_REF}@ENGL-2880`]: "no" }, facts: {} } };
    const result = solve(answered);
    expect(row(result, "cas-college", "fws").status).toBe("partial");
    expect(openQuestions(answered, result, solve)).toEqual([]);
  });

  it("a met row asks nothing, and costs no solve", () => {
    const met: SolveInput = { ...input, courses: [fwsCourse, { ...fwsCourse, id: "WRIT-1380", number: "1380" }, engl2880] };
    const current = solve(met);
    expect(row(current, "cas-college", "fws").status).toBe("met");
    const probe = counting(solve);
    expect(openQuestions(met, current, probe.solve)).toEqual([]);
    expect(probe.calls()).toBe(0);
  });

  it("no matching course on the board: no candidates, no solves", () => {
    const none: SolveInput = { ...input, courses: [fwsCourse] };
    const probe = counting(solve);
    expect(openQuestions(none, solve(none), probe.solve)).toEqual([]);
    expect(probe.calls()).toBe(0);
  });
});

describe("openQuestions — other types", () => {
  const base = { source: { url: "https://catalog.cornell.edu/", anchor: "test" }, quote: "A sentence from the catalog." };
  const src = { url: "https://catalog.cornell.edu/", anchor: "test" };
  const FACT = "studentFact:departmentExamPassed:ECON";
  const APPROVED = "approvedFor:p/grad";

  const major = (): Layer => ({
    id: "p",
    kind: "major",
    family: "cas",
    name: "M",
    catalogYear: "2026-27",
    programId: "p",
    rows: [
      // Three graduate courses, each needing advisor approval.
      {
        id: "grad",
        kind: "pool",
        label: "Three graduate courses",
        group: "Core",
        source: src,
        rule: { allOf: [{ subject: ["BIOMG"] }, { number: { min: 5000 } }, { answered: APPROVED }] },
        requiredCourses: 3,
        requiredCredits: 0,
      },
      { id: "credits", kind: "credits", label: "12 credits", group: "Credits", source: src, rule: { subject: ["BIOMI", "HIST"] }, requiredCredits: 12 },
      {
        id: "intro",
        kind: "seat",
        label: "Intro or the placement exam",
        group: "Core",
        source: src,
        rule: { anyOf: [{ course: ["ECON-1110"] }, { allOf: [{ answered: FACT }, { subject: ["HIST"] }] }] },
      },
    ],
    questions: [
      { ...base, type: "approvedFor", row: "grad", courses: { allOf: [{ subject: ["BIOMG"] }, { number: { min: 5000 } }] }, approver: "advisor" },
      { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] },
      { ...base, type: "studentFact", fact: "departmentExamPassed", subject: "ECON" },
    ],
  });

  const board = (): DistCourse[] => [
    course("BIOMG-6330"),
    course("BIOMI-4850", { credits: 2, creditsMax: 3 }),
    course("HIST-1530", { credits: 4 }),
    course("HIST-2000", { credits: 3 }),
  ];

  it("the test layer lints clean", () => {
    expect(lintLayer(major())).toEqual([]);
  });

  it("a yes that leaves the row partial is not asked (approvedFor 1 of 3 → 1 of 3 still short)", () => {
    // One approved course already counts; a second would still leave it partial.
    const input: SolveInput = {
      layers: [major()],
      courses: [...board(), course("BIOMG-6340")],
      ctx: { programId: "p" },
      answers: { marks: { [`${APPROVED}@BIOMG-6330`]: "yes" }, facts: {} },
    };
    const current = solve(input);
    expect(row(current, "p", "grad").status).toBe("partial");
    const open = openQuestions(input, current, solve);
    expect(open.find((q) => q.ref === APPROVED)).toBeUndefined();
  });

  it("asks credit and fact questions that would meet a row, in question order", () => {
    const input: SolveInput = { layers: [major()], courses: board(), ctx: { programId: "p" } };
    const current = solve(input);
    expect(row(current, "p", "credits").status).toBe("partial"); // 2 + 4 + 3 = 9 of 12
    expect(row(current, "p", "intro").status).toBe("unmet");
    const open = openQuestions(input, current, solve);
    // grad: unmet → partial with one approval (an improvement).
    expect(open.map((q) => q.key)).toEqual([`${APPROVED}@BIOMG-6330`, FACT]);
    expect(open[1].rowIds).toEqual(["intro"]);
    expect(open[1].courseId).toBeUndefined();
  });

  it("creditsTaken is asked when its largest value meets a credit row", () => {
    const input: SolveInput = {
      layers: [major()],
      courses: [...board(), course("HIST-3000", { credits: 2 })], // 2 + 4 + 3 + 2 = 11 of 12
      ctx: { programId: "p" },
    };
    const current = solve(input);
    const open = openQuestions(input, current, solve);
    const credit = open.find((q) => q.ref === "creditsTaken:BIOMI-4850");
    expect(credit).toMatchObject({ key: "creditsTaken:BIOMI-4850", courseId: "BIOMI-4850", rowIds: ["credits"] });

    // Answering 3 and applying it before the solve meets the row.
    const marks = { "creditsTaken:BIOMI-4850": 3 };
    const answered: SolveInput = {
      ...input,
      courses: applyCourseMarks(input.courses, input.layers, marks),
      answers: { marks, facts: {} },
    };
    const after = solve(answered);
    expect(row(after, "p", "credits").status).toBe("met");
    expect(openQuestions(answered, after, solve).find((q) => q.ref === "creditsTaken:BIOMI-4850")).toBeUndefined();
  });

  it("is deterministic: same input, same output", () => {
    const input: SolveInput = { layers: [major()], courses: board(), ctx: { programId: "p" } };
    const a = openQuestions(input, solve(input), solve);
    const b = openQuestions(input, solve(input), solve);
    expect(a).toEqual(b);
  });
});

// Spec 020 Testing: the probe adds one solve per open question. Budget for a
// realistic board (CAS college + a major, 50 courses, five open questions),
// sized with headroom for a loaded machine like the engine's perf tests.
describe("openQuestions — performance", { timeout: 60_000 }, () => {
  const src = { url: "https://catalog.cornell.edu/", anchor: "test" };
  const gated = ["BIOMG-6310", "BIOMG-6330", "BIOMG-6360", "BIOMG-6390", "BIOMG-6980"];
  const major: Layer = {
    id: "perf",
    kind: "major",
    family: "cas",
    name: "Perf",
    catalogYear: "2026-27",
    programId: "perf",
    rows: gated.map((id, i) => ({
      id: `seat-${i}`,
      kind: "seat" as const,
      label: `Approved course ${i + 1}`,
      group: "Core",
      source: src,
      rule: { allOf: [{ course: [id] }, { answered: `approvedFor:perf/seat-${i}` }] },
    })),
    questions: gated.map((id, i) => ({
      type: "approvedFor" as const,
      row: `seat-${i}`,
      courses: { course: [id] },
      approver: "advisor" as const,
      source: src,
      quote: "Graduate-level courses are acceptable with permission of your advisor.",
    })),
  };
  const TAGS = ["ALC-AS", "HST-AS", "SCD-AS", "ETM-AS", "GLC-AS", "SSC-AS", "PHS-AS", "BIO-AS", "SDS-AS", "SMR-AS"];
  const filler = Array.from({ length: 45 }, (_, i) =>
    course(`HIST-${2000 + i}`, { credits: 3 + (i % 2), attrs: [{ value: TAGS[i % TAGS.length] }, { value: TAGS[(i * 3 + 1) % TAGS.length] }] })
  );
  const board = [fwsCourse, ...gated.map((id) => course(id)), ...filler].slice(0, 50);

  it("asks all five questions on a 50-course board within budget", () => {
    const layers = [casWithFwsQuestion(), major];
    expect(lintLayer(major)).toEqual([]);
    const input: SolveInput = { layers, courses: board, ctx: { programId: "perf", entryTerm: "FA26", transfer: "none" } };
    const current = solve(input);
    const t0 = performance.now();
    const open = openQuestions(input, current, solve);
    const ms = performance.now() - t0;
    expect(open.map((q) => q.key)).toEqual(gated.map((id, i) => `approvedFor:perf/seat-${i}@${id}`));
    expect(ms).toBeLessThan(5000);
  });
});

describe("openQuestions — creditsTaken tries every allowed value (audit finding 4)", () => {
  const layer: Layer = {
    id: "M",
    kind: "major",
    family: "cas",
    name: "M",
    catalogYear: "2026-27",
    programId: "M",
    rows: [
      {
        id: "elective",
        kind: "pool",
        label: "Electives, at most 3 BIOMI credits",
        group: "Core",
        source: SRC,
        rule: { subject: ["BIOMI", "HIST"] },
        requiredCourses: 1,
        requiredCredits: 3,
        limits: [{ label: "BIOMI cap", rule: { subject: ["BIOMI"] }, maxCredits: 3 }],
      },
    ],
    questions: [{ type: "creditsTaken", course: "BIOMI-4850", values: [2, 3, 4], source: SRC, quote: "2 to 4 credits." }],
  };
  const input: SolveInput = { layers: [layer], courses: [course("BIOMI-4850", { credits: 2, creditsMax: 4 })], ctx: { programId: "M" } };

  it("asks when a middle value meets a capped row though the largest does not", () => {
    expect(lintLayer(layer)).toEqual([]);
    const current = solve(input);
    expect(row(current, "M", "elective").status).toBe("partial");
    // The largest value alone (4) breaks the cap and meets nothing...
    const at4 = solve({ ...input, courses: applyCourseMarks(input.courses, [layer], { "creditsTaken:BIOMI-4850": 4 }) });
    expect(row(at4, "M", "elective").status).not.toBe("met");
    // ...but 3 meets it, so the question is asked, on that row.
    const open = openQuestions(input, current, solve);
    expect(open.map((q) => q.key)).toEqual(["creditsTaken:BIOMI-4850"]);
    expect(open[0].rows).toEqual([{ layerId: "M", rowId: "elective" }]);
  });
});

describe("answered leaves are scoped to their question's courses (audit finding 3)", () => {
  const REF = "approvedFor:L/grad";
  const layer: Layer = {
    id: "L",
    kind: "major",
    family: "cas",
    name: "L",
    catalogYear: "2026-27",
    programId: "L",
    rows: [
      {
        id: "grad",
        kind: "pool",
        label: "One advanced BIOMG course",
        group: "Core",
        source: SRC,
        rule: { anyOf: [{ allOf: [{ subject: ["BIOMG"] }, { number: { min: 3000, max: 4999 } }] }, { answered: REF }] },
        requiredCourses: 1,
        requiredCredits: 0,
      },
    ],
    questions: [
      {
        type: "approvedFor",
        row: "grad",
        courses: { allOf: [{ subject: ["BIOMG"] }, { number: { min: 5000 } }] },
        approver: "advisor",
        source: SRC,
        quote: "Graduate courses with advisor approval.",
      },
    ],
  };

  it("a stray yes on a course outside the question's courses counts nowhere (engine and checker agree)", () => {
    expect(lintLayer(layer)).toEqual([]);
    const r = solve({
      layers: [layer],
      courses: [course("MATH-1110")],
      ctx: { programId: "L" },
      answers: { marks: { [`${REF}@MATH-1110`]: "yes" }, facts: {} },
    });
    expect(row(r, "L", "grad").status).toBe("unmet");
    expect(row(r, "L", "grad").courses).toEqual([]);
    expect(r.verifyLog).toEqual([]);
  });

  it("a yes on a course inside the question's courses still counts", () => {
    const r = solve({
      layers: [layer],
      courses: [course("BIOMG-6330")],
      ctx: { programId: "L" },
      answers: { marks: { [`${REF}@BIOMG-6330`]: "yes" }, facts: {} },
    });
    expect(row(r, "L", "grad").status).toBe("met");
    expect(r.verifyLog).toEqual([]);
  });
});
