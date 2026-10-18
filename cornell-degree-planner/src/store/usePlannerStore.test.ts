import { describe, expect, it } from "vitest";
import { normalizeCardDensity } from "./usePlannerStore";

describe("normalizeCardDensity", () => {
  it("keeps the two known densities", () => {
    expect(normalizeCardDensity("compact")).toBe("compact");
    expect(normalizeCardDensity("detailed")).toBe("detailed");
  });
  it("falls back to detailed for anything else (missing or stale storage)", () => {
    expect(normalizeCardDensity(undefined)).toBe("detailed");
    expect(normalizeCardDensity("dense")).toBe("detailed");
    expect(normalizeCardDensity(1)).toBe("detailed");
  });
});
