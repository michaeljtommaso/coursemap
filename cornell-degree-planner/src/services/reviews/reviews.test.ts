import { describe, it, expect } from "vitest";
import { NullAdapter } from "./NullAdapter";
import { professorEmptyState, EM_DASH } from "@/lib/planner/compare";

/**
 * NullAdapter smoke (spec 013 §4) — the kill-switch contract: whenever the
 * NullAdapter is the wired provider (REVIEWS_PROVIDER: "null"), the reviews
 * seam returns null for everything and the professor cell falls back to an
 * honest empty state — zero professor UI can render anywhere. The launch
 * switch flipped to "rmp" on 2026-07-11, so these tests assert the kill
 * switch's contract against the NullAdapter DIRECTLY rather than pinning the
 * live config (which would re-break on every authorized provider change);
 * getReviewsProvider()'s "rmp" path is exercised by the running app, and its
 * "null" path is a two-line switch guarded by types.
 */

describe("reviews seam — NullAdapter kill switch (spec 013 §3a/§4)", () => {
  it("every NullAdapter read resolves to null", async () => {
    const p = new NullAdapter();
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
