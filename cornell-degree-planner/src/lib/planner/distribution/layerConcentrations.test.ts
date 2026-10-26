import { describe, it, expect } from "vitest";
import { LayerSchema, UserProfileSchema } from "@/lib/schemas";

const SRC = { url: "https://catalog.cornell.edu/example/", anchor: "Requirements" };
const major = (extra: Record<string, unknown> = {}) => ({
  id: "test-major",
  kind: "major",
  family: "cals",
  name: "Test Major",
  catalogYear: "2026-27",
  programId: "test-major",
  rows: [{ id: "one", kind: "confirm", label: "One", group: "Core", source: SRC }],
  ...extra,
});

describe("LayerSchema — concentrations", () => {
  it("is optional and round-trips", () => {
    expect(LayerSchema.parse(major()).concentrations).toBeUndefined();
    expect(LayerSchema.parse(major({ concentrations: { min: 1, max: 2 } })).concentrations).toEqual({ min: 1, max: 2 });
  });

  it("rejects non-integers, negatives, max 0 and unknown keys", () => {
    for (const bad of [
      { min: 0.5, max: 1 },
      { min: -1, max: 1 },
      { min: 0, max: 0 },
      { min: 0 },
      { min: 0, max: 1, extra: true },
    ]) {
      expect(LayerSchema.safeParse(major({ concentrations: bad })).success).toBe(false);
    }
  });
});

describe("UserProfileSchema — prefs.concentration", () => {
  const prefs = (concentration: unknown) =>
    UserProfileSchema.parse({ prefs: { concentration } }).prefs?.concentration;

  it("keeps a well-formed choice", () => {
    expect(prefs({ programId: "maj", ids: ["a", "b"] })).toEqual({ programId: "maj", ids: ["a", "b"] });
    expect(prefs(null)).toBeNull();
  });

  it("a malformed stored value reads as unanswered, never a parse failure", () => {
    expect(prefs({ programId: "maj", ids: "a" })).toBeNull();
    expect(prefs("a")).toBeNull();
    expect(prefs({ ids: [] })).toBeNull();
  });
});
