import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MajorMatch } from "@/hooks/useMajorMatch";
import { MatchSummary, MissingAmount } from "./MajorMatchPanel";

// The panel's data hooks reach Firebase; this test renders one line only.
vi.mock("@/hooks/useMajorMatch", () => ({ useMajorMatch: () => ({ matches: [], ready: true, college: null, needsCollege: false }) }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => ({ programs: [], loading: false }) }));
vi.mock("@/store/useProgramStore", () => ({ useProgramStore: () => null }));
vi.mock("@/store/usePlannerStore", () => ({ usePlannerStore: () => null }));
vi.mock("@/components/onboarding/CollegePicker", () => ({ CollegePicker: () => null }));

// Static render (no DOM library in this repo): what a "Still needed" line shows.

type Missing = MajorMatch["missing"][number];
const text = (m: Missing) =>
  renderToStaticMarkup(<MissingAmount missing={m} />)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

describe("MissingAmount", () => {
  const base: Missing = { requirementId: "r", label: "Requirement" };

  it("liberal studies short only on its group rules says what it needs", () => {
    expect(text({ ...base, credits: 2, detail: "needs 1 more group, Race & Equity" })).toBe(
      "needs 1 more group, Race & Equity"
    );
  });

  it("courses short wins over the detail; credits show when there is no detail", () => {
    expect(text({ ...base, courses: 2, credits: 6, detail: "needs 1 more group" })).toBe("2 more courses");
    expect(text({ ...base, courses: 1 })).toBe("1 more course");
    expect(text({ ...base, credits: 3 })).toBe("3 cr");
  });

  it("requirements the app can't check say so", () => {
    expect(text({ ...base, credits: 3, reason: "no-data" })).toBe("needs data we don't have yet");
    expect(text({ ...base, reason: "unchecked" })).toBe("can't check this automatically");
  });
});

describe("MatchSummary", () => {
  const match = (over: Partial<MajorMatch>): MajorMatch =>
    ({
      program: { id: "p", name: "Classics" },
      engine: "distribution",
      pct: 20,
      creditsSatisfied: 3,
      creditsRequired: 0,
      requirementsLeft: 2,
      matched: [],
      missing: [],
      uncounted: [],
      ...over,
    }) as MajorMatch;
  const line = (m: MajorMatch) =>
    renderToStaticMarkup(<MatchSummary match={m} name="Classics" />)
      .replace(/<[^>]+>/g, "")
      .trim();

  it("a major scored on its closest track names the track", () => {
    expect(line(match({ track: "Latin" }))).toBe("Closest track: Latin. 2 Classics requirements left.");
    expect(line(match({ track: "Latin", requirementsLeft: 0 }))).toBe(
      "Your plan meets every Classics requirement we can check on the Latin track."
    );
  });

  it("other majors read as before", () => {
    expect(line(match({ requirementsLeft: 1 }))).toBe("1 Classics requirement left.");
    expect(line(match({ requirementsLeft: 0 }))).toBe("Your plan meets every Classics requirement we can check.");
  });
});
