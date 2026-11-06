import { describe, expect, it } from "vitest";
import { solve } from "./index";
import { verifyAssignment } from "./verify";
import type { CourseRule, DistCourse, Layer } from "./types";

// Spec 025 examScore leaf through the solver AND the independent checker:
// "MATH 1110, but AP credit counts only at a 5" (a Nutritional Sciences-style
// row), plus a distribution row that refuses all exam credit.

const source = { url: "https://example.edu/catalog", anchor: "req" };
const calcAt5: CourseRule = {
  allOf: [
    { course: ["MATH-1110"] },
    { anyOf: [{ not: { creditKind: ["ap", "ib", "alevel", "intl"] } }, { examScore: { exam: ["ap-calculus-ab", "ap-calculus-bc"], scores: ["5"] } }] },
  ],
};
const layer: Layer = {
  id: "fixture-major",
  kind: "major",
  family: "cals",
  name: "Fixture",
  catalogYear: "2026-27",
  programId: "fixture",
  rows: [{ id: "calc", label: "Calculus", group: "Core", source, kind: "seat", rule: calcAt5 }],
};

const apCalc = (score: string | undefined): DistCourse => ({
  id: "MATH-1110",
  subject: "MATH",
  number: "1110",
  credits: 4,
  isCredit: true,
  creditKind: "ap",
  ...(score ? { creditExam: "ap-calculus-bc", creditScore: score } : {}),
});

function run(courses: DistCourse[]) {
  const input = { layers: [layer], courses, ctx: { programId: "fixture" } };
  const result = solve(input);
  return { result, row: result.layers[0].rows[0], report: verifyAssignment(input, result) };
}

describe("examScore through solve + verify", () => {
  it("AP Calculus BC at 5 fills the seat, and the checker agrees", () => {
    const { row, result, report } = run([apCalc("5")]);
    expect(row.status).toBe("met");
    expect(row.courses.map((c) => c.courseId)).toEqual(["MATH-1110"]);
    expect(result.verifyLog).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("at 4 it does not", () => {
    const { row, report } = run([apCalc("4")]);
    expect(row.status).toBe("unmet");
    expect(report.ok).toBe(true);
  });

  it("credit with no score fails closed", () => {
    expect(run([apCalc(undefined)]).row.status).toBe("unmet");
  });

  it("the course taken at Cornell still fills it", () => {
    expect(run([{ id: "MATH-1110", subject: "MATH", number: "1110", credits: 4 }]).row.status).toBe("met");
  });
});
