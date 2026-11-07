import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: { getState: () => ({ openPanel: vi.fn(), setPanelOpen: vi.fn() }) },
}));

const { plannerSteps, requirementsSteps, classesSteps, tourPathFor, TOUR_READY } = await import("./tourSteps");

const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

describe("tourPathFor (spec 033 D2)", () => {
  it("the blank canvas is the undecided path", () => {
    expect(tourPathFor("blank", null)).toBe("discover");
  });
  it("an Engineering-format major (no family field) is the template path", () => {
    expect(tourPathFor("cornell-cs-bs-2026", { college: "College of Engineering" })).toBe("engineering");
  });
  it("an Arts & Sciences or CALS major is the layer path", () => {
    expect(tourPathFor("cornell-english-ba", { family: "cas", college: "College of Arts and Sciences" })).toBe("layer");
    expect(tourPathFor("cornell-ansc-bs", { family: "cals", college: "CALS" })).toBe("layer");
  });
});

describe("plannerSteps (spec 033 D2)", () => {
  it("Engineering: card, professor and still needed before the catalog; plans before save", () => {
    expect(ids(plannerSteps("engineering", null))).toEqual([
      "welcome", "card", "professor", "still-needed", "catalog", "major", "plans", "save",
    ]);
  });
  it("CAS/CALS: an empty board starts with what the major needs", () => {
    expect(ids(plannerSteps("layer", "College of Arts and Sciences"))).toEqual([
      "welcome", "still-needed", "catalog", "add-class", "major", "plans", "save",
    ]);
  });
  it("undecided: the Majors tab comes right after the welcome", () => {
    expect(ids(plannerSteps("discover", null))).toEqual([
      "welcome", "majors", "catalog", "add-class", "major", "plans", "save",
    ]);
  });
  it("every step after the welcome points at something", () => {
    for (const path of ["engineering", "layer", "discover"] as const) {
      for (const s of plannerSteps(path, null)) expect(s.target?.length).toBeGreaterThan(0);
    }
  });
});

describe("page tours (spec 033 D4)", () => {
  it("Requirements: a row (with a fallback), then Try", () => {
    const steps = requirementsSteps();
    expect(ids(steps)).toEqual(["row", "try"]);
    expect(steps[0].fallback).toEqual(["[data-requirement]"]);
  });
  it("Classes: filters, then a row", () => {
    expect(ids(classesSteps())).toEqual(["filters", "row"]);
  });
  it("each tour waits for its page's first target", () => {
    expect(Object.keys(TOUR_READY).sort()).toEqual(["classes", "planner", "requirements"]);
  });
});
