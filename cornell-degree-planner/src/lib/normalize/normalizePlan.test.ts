import { describe, it, expect } from "vitest";
import { normalizePlan, isCurrentPlanShape } from "./normalizePlan";
import { PLAN_SCHEMA_VERSION } from "@/lib/schemas";

const snap = (id: string) => ({ id, subject: id.split("-")[0], number: id.split("-")[1], title: id, creditsMin: 3, creditsMax: 3 });

function current(over: Record<string, unknown> = {}) {
  return {
    name: "My Plan",
    programId: "cornell-cs-bs-2026",
    schemaVersion: PLAN_SCHEMA_VERSION,
    placements: [
      { id: "p1", courseId: "MATH-1910", sem: 1, order: 0 },
      { id: "p2", courseId: "CS-2110", sem: 3, order: 0 },
    ],
    courseSnapshots: { "MATH-1910": snap("MATH-1910"), "CS-2110": snap("CS-2110") },
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    ...over,
  };
}

describe("normalizePlan — schemaVersion gate (spec 014 §D5)", () => {
  it("the placement model is schemaVersion 3", () => {
    expect(PLAN_SCHEMA_VERSION).toBe(3);
  });

  it("reads an OLDER schemaVersion (v2 slot model) as EMPTY — no conversion", () => {
    const out = normalizePlan({
      name: "Old",
      programId: "cornell-cs-bs-2026",
      schemaVersion: 2,
      // the old slot-model fields are simply not read
      ...({ slotSelections: { "cs-s1": "MATH-1910" }, completedSlotIds: ["cs-s1"] } as object),
    });
    expect(out).toMatchObject({
      name: "Old",
      programId: "cornell-cs-bs-2026",
      placements: [],
      courseSnapshots: {},
      completedIds: [],
      inProgressIds: [],
      waivedRequirementIds: [],
      legacy: true,
    });
  });

  it("reads a v1 doc (no schemaVersion at all) as empty", () => {
    expect(normalizePlan({ name: "x", programId: "p" })).toMatchObject({ placements: [], legacy: true, schemaVersion: 1 });
  });

  it("reads a current-version doc that is MISSING placements as empty", () => {
    const { placements: _p, ...rest } = current();
    void _p;
    expect(normalizePlan(rest).legacy).toBe(true);
    expect(isCurrentPlanShape(rest)).toBe(false);
  });

  it("passes a valid current doc through", () => {
    const out = normalizePlan(current({ completedIds: ["p1"], waivedRequirementIds: ["cs-fws"] }));
    expect(out.legacy).toBe(false);
    expect(out.placements).toEqual(current().placements);
    expect(out.completedIds).toEqual(["p1"]);
    expect(out.waivedRequirementIds).toEqual(["cs-fws"]);
    expect(Object.keys(out.courseSnapshots).sort()).toEqual(["CS-2110", "MATH-1910"]);
  });
});

describe("normalizePlan — repair", () => {
  it("sanitizes placements (dedupe ids, clamp sem, dense orders)", () => {
    const out = normalizePlan(
      current({
        placements: [
          { id: "p1", courseId: "MATH-1910", sem: 1, order: 5 },
          { id: "p1", courseId: "CS-2110", sem: 2, order: 0 },
          { id: "p3", courseId: "CS-4820", sem: 42, order: 3 },
        ],
      })
    );
    expect(out.placements).toEqual([
      { id: "p1", courseId: "MATH-1910", sem: 1, order: 0 },
      { id: "p3", courseId: "CS-4820", sem: 10, order: 0 },
    ]);
  });

  it("drops marks for placements that don't exist and dedupes them", () => {
    const out = normalizePlan(current({ completedIds: ["p1", "p1", "ghost"], inProgressIds: ["ghost", "p2"] }));
    expect(out.completedIds).toEqual(["p1"]);
    expect(out.inProgressIds).toEqual(["p2"]);
  });

  it("holds one manual state per placement: completed wins over in progress", () => {
    const out = normalizePlan(current({ completedIds: ["p1"], inProgressIds: ["p1", "p2"] }));
    expect(out.completedIds).toEqual(["p1"]);
    expect(out.inProgressIds).toEqual(["p2"]);
  });

  it("trims courseSnapshots to placed courses", () => {
    const out = normalizePlan(
      current({ courseSnapshots: { "MATH-1910": snap("MATH-1910"), "CS-2110": snap("CS-2110"), "OLD-1": snap("OLD-1") } })
    );
    expect(Object.keys(out.courseSnapshots).sort()).toEqual(["CS-2110", "MATH-1910"]);
  });

  it("defaults non-string name/programId to empty strings", () => {
    const out = normalizePlan({ ...current(), name: 42, programId: null });
    expect(out.name).toBe("");
    expect(out.programId).toBe("");
  });
});

describe("normalizePlan — retired program ids (spec 019 D12)", () => {
  const OLD = "cornell-infosci-bs-2025";
  const NEW = "cornell-information-science-bs-2026";

  it("reads an Information Science plan saved under the old id as the new program, waivers translated", () => {
    const out = normalizePlan(
      current({
        programId: OLD,
        waivedRequirementIds: ["infosci-s1-info1300", "infosci-s1-fwis", "infosci-elective", "not-a-requirement"],
      })
    );
    expect(out.programId).toBe(NEW);
    // fwis maps to null (dropped); an id the map doesn't name is dropped.
    expect(out.waivedRequirementIds).toEqual([`${NEW}:core-web`, `${NEW}:electives`]);
  });

  it("reads a Communication plan under the old id as the new program", () => {
    const out = normalizePlan(
      current({ programId: "cornell-comm-bs-2025", waivedRequirementIds: ["comm-stats", "comm-s1-pe"] })
    );
    expect(out.programId).toBe("cornell-communication-bs-2026");
    expect(out.waivedRequirementIds).toEqual(["cornell-communication-bs-2026:data-statistics"]);
  });

  it("is idempotent over a mixed list (already-translated ids kept, folded duplicates removed)", () => {
    const doc = current({
      programId: OLD,
      waivedRequirementIds: [`${NEW}:core-web`, "infosci-s1-info1300", "infosci-stats"],
    });
    const once = normalizePlan(doc);
    expect(once.waivedRequirementIds).toEqual([`${NEW}:core-web`, `${NEW}:statistics`]);
    // After a save the doc keeps the old programId (content writes don't carry
    // it) but holds the translated waivers: reading again changes nothing.
    const again = normalizePlan({ ...doc, waivedRequirementIds: once.waivedRequirementIds });
    expect(again.programId).toBe(NEW);
    expect(again.waivedRequirementIds).toEqual(once.waivedRequirementIds);
  });

  it("translates before the 80-waiver cap, so old ids that drop out don't crowd out a real waiver", () => {
    const stale = Array.from({ length: 85 }, (_, i) => `retired-${i}`);
    const out = normalizePlan(current({ programId: OLD, waivedRequirementIds: [...stale, "infosci-stats"] }));
    expect(out.waivedRequirementIds).toEqual([`${NEW}:statistics`]);
  });

  it("leaves a plan on any other program untouched", () => {
    const waived = ["infosci-s1-info1300", "cs-elective", "cas-college:fws"];
    const out = normalizePlan(current({ waivedRequirementIds: waived }));
    expect(out.programId).toBe("cornell-cs-bs-2026");
    expect(out.waivedRequirementIds).toEqual(waived);
  });

  it("canonicalizes the id of a slot-model doc read as empty", () => {
    expect(normalizePlan({ name: "Old", programId: OLD, schemaVersion: 2 })).toMatchObject({
      programId: NEW,
      legacy: true,
    });
  });
});
