import { describe, it, expect } from "vitest";
import {
  isReviewStale,
  toFetchedAtMs,
  summaryFromDoc,
  courseViewFromDocs,
  variesByInstructor,
  formatStars,
  formatDifficulty,
  STALE_AFTER_DAYS,
  type ProfessorReviewsDocLike,
  type CourseInstructorHistoryDocLike,
} from "./reviews";
import type { ProfessorSummary } from "@/services/reviews";

/**
 * Pure reviews-helper tests (spec 013 §3b/§3c/§3d) — the staleness rule, the
 * doc→summary tier map, the timeline assembly, and the divergence math. The
 * RmpAdapter is a thin Firestore shell over exactly these functions, so proving
 * them here proves the adapter's behavior offline.
 */

const NOW = Date.UTC(2026, 6, 11); // 2026-07-11, the session date
const DAY = 24 * 60 * 60 * 1000;
const tsDaysAgo = (d: number) => ({ toMillis: () => NOW - d * DAY });

describe("isReviewStale — the 90-day auto-hide cutoff (spec §3b)", () => {
  it("null fetch time reads as stale (hidden), never fresh", () => {
    expect(isReviewStale(null, NOW)).toBe(true);
  });
  it("fresh within the window is shown; past the window auto-hides", () => {
    expect(isReviewStale(NOW - 10 * DAY, NOW)).toBe(false);
    expect(isReviewStale(NOW - (STALE_AFTER_DAYS + 1) * DAY, NOW)).toBe(true);
  });
  it("exactly at the cutoff age is still shown (inclusive-fresh boundary)", () => {
    expect(isReviewStale(NOW - STALE_AFTER_DAYS * DAY, NOW)).toBe(false);
  });
});

describe("toFetchedAtMs — Firestore Timestamp / Date / epoch / ISO coercion", () => {
  it("handles the SDK Timestamp, {seconds}, Date, number, ISO, and junk", () => {
    expect(toFetchedAtMs({ toMillis: () => 123 })).toBe(123);
    expect(toFetchedAtMs({ seconds: 2 })).toBe(2000);
    expect(toFetchedAtMs(new Date(456))).toBe(456);
    expect(toFetchedAtMs(789)).toBe(789);
    expect(toFetchedAtMs("2026-07-11T00:00:00Z")).toBe(NOW);
    expect(toFetchedAtMs(null)).toBeNull();
    expect(toFetchedAtMs("not-a-date")).toBeNull();
  });
});

function proDoc(overrides: Partial<ProfessorReviewsDocLike> = {}): ProfessorReviewsDocLike {
  return {
    netid: "al123",
    displayName: "Ada Lovelace",
    match: { tier: "verified", candidateName: "Ada Lovelace", url: "https://rmp/1" },
    rating: 4.2,
    difficulty: 3.1,
    count: 42,
    topSnippet: "Clear lectures and fair exams.",
    fetchedAt: tsDaysAgo(5),
    ...overrides,
  };
}

describe("summaryFromDoc — tier map + stale→null (spec §3b/§3c)", () => {
  it("maps a fresh verified doc, tier → confidence, url from match", () => {
    const s = summaryFromDoc(proDoc(), NOW);
    expect(s).toEqual({
      rating: 4.2,
      difficulty: 3.1,
      count: 42,
      confidence: "verified",
      url: "https://rmp/1",
      topSnippet: "Clear lectures and fair exams.",
    } satisfies ProfessorSummary);
  });
  it("a professor with zero ratings has no rating or difficulty (RMP reports 0)", () => {
    const s = summaryFromDoc(proDoc({ rating: 0, difficulty: 0, count: 0 }), NOW);
    expect(s?.rating).toBeNull();
    expect(s?.difficulty).toBeNull();
    expect(s?.url).toBe("https://rmp/1");
  });
  it("carries the probable tier through", () => {
    const s = summaryFromDoc(proDoc({ match: { tier: "probable", url: "https://rmp/2" } }), NOW);
    expect(s?.confidence).toBe("probable");
  });
  it("a stale doc returns null (auto-hide, never a wrong current rating)", () => {
    expect(summaryFromDoc(proDoc({ fetchedAt: tsDaysAgo(200) }), NOW)).toBeNull();
  });
  it("omits topSnippet when the doc has none", () => {
    const s = summaryFromDoc(proDoc({ topSnippet: null }), NOW);
    expect(s?.topSnippet).toBeUndefined();
  });
});

function history(): CourseInstructorHistoryDocLike {
  return {
    courseId: "CS-2110",
    terms: [
      { roster: "FA24", instructors: [{ netid: "aa1", name: "Anne Alpha" }] },
      { roster: "FA25", instructors: [{ netid: "al123", name: "Ada Lovelace" }] },
    ],
    fetchedAt: tsDaysAgo(3),
  };
}

describe("courseViewFromDocs — perProfessor (latest roster) + timeline (spec §3d)", () => {
  const summaries = new Map<string, ProfessorSummary>([
    ["al123", { rating: 4.2, difficulty: 3.1, count: 42, confidence: "verified", url: "https://rmp/1" }],
    ["aa1", { rating: 3.0, difficulty: 3.5, count: 12, confidence: "probable", url: "https://rmp/2" }],
  ]);
  it("perProfessor reflects only the MOST RECENT roster's instructors", () => {
    const v = courseViewFromDocs(history(), summaries);
    expect(v?.perProfessor.map((p) => p.netid)).toEqual(["al123"]);
    expect(v?.perProfessor[0].confidence).toBe("verified");
    expect(v?.perProfessor[0].count).toBe(42);
  });
  it("history is the full timeline, newest term first, each with its link", () => {
    const v = courseViewFromDocs(history(), summaries);
    expect(v?.history.map((h) => [h.term, h.netid])).toEqual([
      ["FA25", "al123"],
      ["FA24", "aa1"],
    ]);
    expect(v?.history[0].url).toBe("https://rmp/1");
  });
  it("instructors without a live summary are omitted (None renders nothing)", () => {
    const only = new Map<string, ProfessorSummary>([
      ["al123", { rating: 4.2, difficulty: 3.1, count: 42, confidence: "verified", url: "https://rmp/1" }],
    ]);
    const v = courseViewFromDocs(history(), only);
    expect(v?.history.map((h) => h.netid)).toEqual(["al123"]); // aa1 dropped
  });
  it("returns null when nothing joins", () => {
    expect(courseViewFromDocs(history(), new Map())).toBeNull();
    expect(courseViewFromDocs(null, summaries)).toBeNull();
  });
});

describe("variesByInstructor — divergence badge math (spec §3d)", () => {
  it("fires on a ≥1.0 spread across ≥2 instructors each with ≥3 ratings", () => {
    expect(
      variesByInstructor([
        { rating: 4.5, count: 10 },
        { rating: 3.1, count: 8 },
      ])
    ).toBe(true);
  });
  it("does not fire below the spread threshold", () => {
    expect(
      variesByInstructor([
        { rating: 4.5, count: 10 },
        { rating: 4.0, count: 8 },
      ])
    ).toBe(false);
  });
  it("ignores instructors below the min-N sample size", () => {
    expect(
      variesByInstructor([
        { rating: 4.5, count: 10 },
        { rating: 2.0, count: 2 }, // too few ratings — excluded → <2 rated
      ])
    ).toBe(false);
  });
  it("needs at least two rated instructors", () => {
    expect(variesByInstructor([{ rating: 4.5, count: 10 }])).toBe(false);
    expect(variesByInstructor([{ rating: null, count: 10 }, { rating: 3.0, count: 5 }])).toBe(false);
  });
});

describe("formatters — no 'N/A', null-safe (spec §3c)", () => {
  it("formatStars / formatDifficulty render one decimal or null", () => {
    expect(formatStars(4.2)).toBe("4.2 ★");
    expect(formatStars(null)).toBeNull();
    expect(formatDifficulty(3.1)).toBe("difficulty 3.1");
    expect(formatDifficulty(null)).toBeNull();
  });
});
