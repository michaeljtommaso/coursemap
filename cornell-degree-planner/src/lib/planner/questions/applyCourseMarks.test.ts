import { describe, it, expect } from "vitest";
import { applyCourseMarks } from "./applyCourseMarks";
import type { DistCourse, Layer } from "../distribution/types";

const SRC = { url: "https://catalog.cornell.edu/", anchor: "test" };
const base = { source: SRC, quote: "A sentence from the catalog." };

const layer: Layer = {
  id: "major",
  kind: "major",
  family: "cals",
  name: "M",
  catalogYear: "2026-27",
  programId: "p",
  rows: [{ id: "r", kind: "seat", label: "R", group: "G", source: SRC, rule: { tag: ["A"] } }],
  questions: [
    { ...base, type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] },
    { ...base, type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4301", "NTRES-4302"], credits: 4 },
  ],
};

const course = (id: string, credits: number, over: Partial<DistCourse> = {}): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, credits, ...over };
};

const board = (): DistCourse[] => [
  course("BIOMI-4850", 2, { creditsMax: 3 }),
  course("NTRES-4300", 1),
  course("HIST-1530", 4),
];

describe("applyCourseMarks", () => {
  it("sets a creditsTaken course to an allowed value, keeping creditsMax", () => {
    const out = applyCourseMarks(board(), [layer], { "creditsTaken:BIOMI-4850": 3 });
    expect(out[0]).toMatchObject({ id: "BIOMI-4850", credits: 3, creditsMax: 3 });
  });

  it("ignores a creditsTaken value outside the question's values, and non-numbers", () => {
    expect(applyCourseMarks(board(), [layer], { "creditsTaken:BIOMI-4850": 4 })[0].credits).toBe(2);
    expect(applyCourseMarks(board(), [layer], { "creditsTaken:BIOMI-4850": "yes" })[0].credits).toBe(2);
  });

  it("sets a sequenceDone anchor to the sequence's credits on yes only", () => {
    expect(applyCourseMarks(board(), [layer], { "sequenceDone:NTRES-4300": "yes" })[1].credits).toBe(4);
    expect(applyCourseMarks(board(), [layer], { "sequenceDone:NTRES-4300": "no" })[1].credits).toBe(1);
  });

  it("leaves other courses untouched (same objects)", () => {
    const input = board();
    const out = applyCourseMarks(input, [layer], { "creditsTaken:BIOMI-4850": 3, "sequenceDone:NTRES-4300": "yes" });
    expect(out[2]).toBe(input[2]);
    expect(out.map((c) => c.credits)).toEqual([3, 4, 4]);
  });

  it("does nothing for a mark whose question no layer asks, or a course not on the board", () => {
    const out = applyCourseMarks(board(), [layer], { "creditsTaken:HIST-1530": 3 });
    expect(out.map((c) => c.credits)).toEqual([2, 1, 4]);
    const noBiomi = board().slice(1);
    expect(applyCourseMarks(noBiomi, [layer], { "creditsTaken:BIOMI-4850": 3 }).map((c) => c.credits)).toEqual([1, 4]);
  });

  it("matches courses through the canonicalizer", () => {
    const canonical = (id: string) => (id === "MICRO-4850" ? "BIOMI-4850" : id);
    const out = applyCourseMarks([course("MICRO-4850", 2)], [layer], { "creditsTaken:BIOMI-4850": 3 }, canonical);
    expect(out[0]).toMatchObject({ id: "MICRO-4850", credits: 3 });
  });

  it("is pure: never mutates its input and always returns a new array", () => {
    const input = board();
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = applyCourseMarks(input, [layer], { "creditsTaken:BIOMI-4850": 3 });
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
    expect(applyCourseMarks(input, [layer], {})).not.toBe(input);
    expect(applyCourseMarks(input, [layer], {})).toEqual(input);
  });
});
