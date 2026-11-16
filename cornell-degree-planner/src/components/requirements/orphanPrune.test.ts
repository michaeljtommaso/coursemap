import { describe, expect, it, vi } from "vitest";

// The hook's plan context is not exercised here (RequirementsPage tests cover it).
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({}) }));
const { canPrune, writeNeedsRoom, WAIVER_CAP } = await import("./orphanPrune");

// Spec 047 D10: when a waiver or answer write would hit its cap.

const full = Array.from({ length: WAIVER_CAP }, (_, i) => `layer:r${i}`);
const fullMarks = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`usedAs:l/r@C-${i}`, "yes" as const]));

describe("orphanPrune", () => {
  it("a new waiver at the cap needs room; removing one never does", () => {
    expect(writeNeedsRoom("waiver", "econ:core", null, { waivedRequirementIds: full, courseMarks: {} })).toBe(true);
    expect(writeNeedsRoom("waiver", full[0], null, { waivedRequirementIds: full, courseMarks: {} })).toBe(false);
    expect(writeNeedsRoom("waiver", "econ:core", null, { waivedRequirementIds: full.slice(1), courseMarks: {} })).toBe(false);
  });

  it("a new mark at the cap needs room; changing or clearing one never does", () => {
    const plan = { waivedRequirementIds: [], courseMarks: fullMarks };
    expect(writeNeedsRoom("mark", "countsFor:math-ba@ECON-3110", "yes", plan)).toBe(true);
    expect(writeNeedsRoom("mark", "usedAs:l/r@C-0", "no", plan)).toBe(false);
    expect(writeNeedsRoom("mark", "countsFor:math-ba@ECON-3110", null, plan)).toBe(false);
  });

  it("prunes only once every program's layers loaded", () => {
    expect(canPrune({ allLayersLoaded: true, liveLayerIds: ["econ"] })).toBe(true);
    expect(canPrune({ allLayersLoaded: false, liveLayerIds: ["econ"] })).toBe(false);
    expect(canPrune({ allLayersLoaded: true, liveLayerIds: [] })).toBe(false);
    expect(canPrune({})).toBe(false);
  });
});
