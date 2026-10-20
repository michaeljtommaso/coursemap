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
  probableHedge,
  PROBABLE_HEDGE,
  lastSameSeasonEntry,
  lastTimeSeason,
  lastTimeLine,
  rosterTermLabel,
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
    netid: "cb123",
    displayName: "Charles Babbage",
    match: { tier: "verified", candidateName: "Charles Babbage", url: "https://rmp/1" },
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
  it("a probable match carries RMP's name for the hedge; a verified one doesn't", () => {
    const p = summaryFromDoc(
      proDoc({ match: { tier: "probable", candidateName: "Charlie Babbage", url: "https://rmp/2" } }),
      NOW
    );
    expect(p?.rmpName).toBe("Charlie Babbage");
    const v = summaryFromDoc(proDoc({ match: { tier: "verified", candidateName: "Charles Babbage", url: "https://rmp/1" } }), NOW);
    expect(v?.rmpName).toBeUndefined();
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
      { roster: "FA25", instructors: [{ netid: "cb123", name: "Charles Babbage" }] },
    ],
    fetchedAt: tsDaysAgo(3),
  };
}

describe("courseViewFromDocs — perProfessor (latest roster) + timeline (spec §3d)", () => {
  const summaries = new Map<string, ProfessorSummary>([
    ["cb123", { rating: 4.2, difficulty: 3.1, count: 42, confidence: "verified", url: "https://rmp/1" }],
    ["aa1", { rating: 3.0, difficulty: 3.5, count: 12, confidence: "probable", url: "https://rmp/2" }],
  ]);
  it("perProfessor reflects only the MOST RECENT roster's instructors", () => {
    const v = courseViewFromDocs(history(), summaries);
    expect(v?.perProfessor.map((p) => p.netid)).toEqual(["cb123"]);
    expect(v?.perProfessor[0].confidence).toBe("verified");
    expect(v?.perProfessor[0].count).toBe(42);
  });
  it("history is the full timeline, newest term first, each with its link", () => {
    const v = courseViewFromDocs(history(), summaries);
    expect(v?.history.map((h) => [h.term, h.netid])).toEqual([
      ["FA25", "cb123"],
      ["FA24", "aa1"],
    ]);
    expect(v?.history[0].url).toBe("https://rmp/1");
  });
  it("instructors without a live summary are omitted (None renders nothing)", () => {
    const only = new Map<string, ProfessorSummary>([
      ["cb123", { rating: 4.2, difficulty: 3.1, count: 42, confidence: "verified", url: "https://rmp/1" }],
    ]);
    const v = courseViewFromDocs(history(), only);
    expect(v?.history.map((h) => h.netid)).toEqual(["cb123"]); // aa1 dropped
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

describe("probableHedge (spec 016 D6)", () => {
  it("names RMP's version when it differs from Cornell's", () => {
    expect(probableHedge("Charles Babbage", "Charlie Babbage")).toBe(
      'We think this is them (RMP lists "Charlie Babbage") — double-check on RMP'
    );
  });
  it("keeps the plain hedge when the names agree or RMP's is unknown", () => {
    expect(probableHedge("Charles Babbage", "charles  babbage")).toBe(PROBABLE_HEDGE);
    expect(probableHedge("Charles Babbage", undefined)).toBe(PROBABLE_HEDGE);
  });
});

// ─── Spec 017 D8/D9 — the "last time" line for future-term cards ─────────────

const hist = (
  terms: Array<{ roster: string; instructors: Array<{ netid: string; name: string }> }>
): CourseInstructorHistoryDocLike => ({ courseId: "CS-2110", terms });

describe("lastSameSeasonEntry (spec 017 D8)", () => {
  it("returns the matching season's term with its first instructor", () => {
    const h = hist([
      { roster: "SP26", instructors: [{ netid: "sp1", name: "Spring Prof" }] },
      { roster: "FA25", instructors: [{ netid: "gh1", name: "Grace Hopper" }] },
    ]);
    expect(lastSameSeasonEntry(h, "FA")).toEqual({
      roster: "FA25",
      netid: "gh1",
      name: "Grace Hopper",
      more: 0,
    });
    expect(lastSameSeasonEntry(h, "SP")?.netid).toBe("sp1");
  });

  it("the newest same-season term wins regardless of stored order", () => {
    const h = hist([
      { roster: "FA24", instructors: [{ netid: "old", name: "Old Prof" }] },
      { roster: "FA26", instructors: [{ netid: "new", name: "New Prof" }] },
      { roster: "FA25", instructors: [{ netid: "mid", name: "Mid Prof" }] },
    ]);
    expect(lastSameSeasonEntry(h, "FA")?.roster).toBe("FA26");
    expect(lastSameSeasonEntry(h, "FA")?.name).toBe("New Prof");
  });

  it("ignores the other season entirely", () => {
    const h = hist([{ roster: "SP27", instructors: [{ netid: "sp", name: "Spring Only" }] }]);
    expect(lastSameSeasonEntry(h, "FA")).toBeNull();
  });

  it("empty / missing history → null", () => {
    expect(lastSameSeasonEntry(null, "FA")).toBeNull();
    expect(lastSameSeasonEntry(undefined, "SP")).toBeNull();
    expect(lastSameSeasonEntry(hist([]), "FA")).toBeNull();
  });

  it("skips a same-season term with no named instructor (staff / TBA)", () => {
    const h = hist([
      { roster: "FA26", instructors: [] },
      { roster: "FA25", instructors: [{ netid: "gh1", name: "Grace Hopper" }] },
    ]);
    expect(lastSameSeasonEntry(h, "FA")?.roster).toBe("FA25");
    expect(lastSameSeasonEntry(hist([{ roster: "FA26", instructors: [] }]), "FA")).toBeNull();
  });

  it("counts the OTHER distinct instructors of that term as `more`", () => {
    const h = hist([
      {
        roster: "FA26",
        instructors: [
          { netid: "a1", name: "Ann A" },
          { netid: "b2", name: "Bo B" },
          { netid: "b2", name: "Bo B" },
          { netid: "a1", name: "Ann A" },
          { netid: "c3", name: "Cy C" },
        ],
      },
    ]);
    expect(lastSameSeasonEntry(h, "FA")).toEqual({ roster: "FA26", netid: "a1", name: "Ann A", more: 2 });
  });
});

describe("lastTimeSeason (spec 017 D8) — only columns after the target", () => {
  // enteringYear 2025: sem 3 = FA26, sem 4 = SP27 (target), sem 5 = FA27, sem 6 = SP28.
  it("far columns report their own season", () => {
    expect(lastTimeSeason(5, 2025, "SP27")).toBe("FA");
    expect(lastTimeSeason(6, 2025, "SP27")).toBe("SP");
  });
  it("the target column and past columns → null", () => {
    expect(lastTimeSeason(4, 2025, "SP27")).toBeNull();
    expect(lastTimeSeason(3, 2025, "SP27")).toBeNull();
    expect(lastTimeSeason(1, 2025, "SP27")).toBeNull();
  });
  it("unknown entering year or target → null (no distance claimed)", () => {
    expect(lastTimeSeason(6, null, "SP27")).toBeNull();
    expect(lastTimeSeason(6, 2025, null)).toBeNull();
    expect(lastTimeSeason(6, 2025, "garbage")).toBeNull();
  });
});

describe("lastTimeLine (spec 017 D8/D9)", () => {
  const entry = { roster: "FA26", netid: "al123", name: "Ada Lovelace", more: 0 };
  const summary = (over: Partial<ProfessorSummary> = {}): ProfessorSummary => ({
    rating: 4.0,
    difficulty: 3.0,
    count: 12,
    confidence: "verified",
    url: "https://example.test/p/1",
    ...over,
  });

  it("labels the term and shows the rating beside it", () => {
    expect(lastTimeLine("FA", entry, summary(), "SP27")).toBe("Last fall (Fall 2026): Ada Lovelace · 4.0 ★");
  });
  it("spring column reads 'Last spring' for a spring before the target", () => {
    expect(lastTimeLine("SP", { ...entry, roster: "SP26" }, summary(), "SP27")).toBe(
      "Last spring (Spring 2026): Ada Lovelace · 4.0 ★"
    );
  });
  it("a term equal to the enrollment target is not 'Last' (it hasn't happened)", () => {
    expect(lastTimeLine("SP", { ...entry, roster: "SP27" }, summary(), "SP27")).toBe(
      "Spring 2027: Ada Lovelace · 4.0 ★"
    );
  });
  it("a term after the enrollment target is not 'Last' either", () => {
    expect(lastTimeLine("FA", { ...entry, roster: "FA27" }, summary(), "SP27")).toBe(
      "Fall 2027: Ada Lovelace · 4.0 ★"
    );
  });
  it("an unknown target can't prove the term is past → no 'Last'", () => {
    expect(lastTimeLine("FA", entry, summary(), null)).toBe("Fall 2026: Ada Lovelace · 4.0 ★");
    expect(lastTimeLine("FA", entry, summary(), "garbage")).toBe("Fall 2026: Ada Lovelace · 4.0 ★");
  });
  it("probable match gets ≈; extra instructors get +N", () => {
    expect(lastTimeLine("FA", { ...entry, more: 2 }, summary({ confidence: "probable" }), "SP27")).toBe(
      "Last fall (Fall 2026): Ada Lovelace · ≈4.0 ★ +2"
    );
  });
  it("no summary (ratings off / stale / absent) or no rating → name only", () => {
    expect(lastTimeLine("FA", entry, null, "SP27")).toBe("Last fall (Fall 2026): Ada Lovelace");
    expect(lastTimeLine("FA", { ...entry, more: 1 }, summary({ rating: null }), "SP27")).toBe(
      "Last fall (Fall 2026): Ada Lovelace +1"
    );
  });
  it("an unparseable roster slug → null (never guess the term)", () => {
    expect(lastTimeLine("FA", { ...entry, roster: "??" }, summary(), "SP27")).toBeNull();
    expect(rosterTermLabel("FA26")).toBe("Fall 2026");
    expect(rosterTermLabel(null)).toBeNull();
  });
});
