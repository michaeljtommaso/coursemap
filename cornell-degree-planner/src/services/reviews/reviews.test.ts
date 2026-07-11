import { describe, it, expect } from "vitest";
import { getReviewsProvider } from "./index";
import { NullAdapter } from "./NullAdapter";
import { professorEmptyState, EM_DASH } from "@/lib/planner/compare";

/**
 * NullAdapter smoke (spec 013 §4) — the kill-switch contract: with the
 * NullAdapter wired (the config default), the reviews seam returns null for
 * everything and the professor cell falls back to an honest empty state. When
 * this holds, zero professor UI can render anywhere.
 */

describe("reviews seam — NullAdapter default (spec 013 §3a/§4)", () => {
  it("getReviewsProvider() returns the NullAdapter by config", () => {
    expect(getReviewsProvider()).toBeInstanceOf(NullAdapter);
  });

  it("every provider read resolves to null", async () => {
    const p = getReviewsProvider();
    await expect(p.getProfessorSummary("abc123")).resolves.toBeNull();
    await expect(p.getCourseView("CS-2110")).resolves.toBeNull();
  });

  it("the professor cell renders the honest empty state for a null summary", () => {
    // Far course + configured target → the announced-closer line.
    expect(professorEmptyState("far", true)).toBe("instructors announced closer to the semester");
    // Near (or no target) with no data → a plain em-dash, never empty stars.
    expect(professorEmptyState("near", true)).toBe(EM_DASH);
    expect(professorEmptyState("far", false)).toBe(EM_DASH);
  });
});
