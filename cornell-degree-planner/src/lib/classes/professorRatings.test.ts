import { describe, it, expect } from "vitest";
import {
  CatalogIndexChunkSchema,
  CatalogIndexRecordSchema,
  ProfessorRatingsDocSchema,
} from "@/lib/schemas";
import { STALE_AFTER_DAYS } from "@/lib/planner/reviews";
import { ratingsFromDoc, isWellRated, displayedRating, rowRating } from "./professorRatings";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 19);

const base = {
  id: "CS-2110",
  subject: "CS",
  number: "2110",
  title: "Object-Oriented Programming and Data Structures",
  creditsMin: 3,
  creditsMax: 4,
  hasPrereqs: true,
};

describe("CatalogIndexRecordSchema — spec 017 additive fields", () => {
  it("an old record without roster/lead parses with both defaulted to null", () => {
    const r = CatalogIndexRecordSchema.parse(base);
    expect(r.roster).toBeNull();
    expect(r.lead).toBeNull();
    expect(r.offered).toEqual([]);
  });

  it("an old chunk of records still parses whole", () => {
    const chunk = CatalogIndexChunkSchema.parse({ records: [base, { ...base, id: "CS-1110" }] });
    expect(chunk.records.map((r) => r.roster)).toEqual([null, null]);
  });

  it("a new record carries roster and lead", () => {
    const r = CatalogIndexRecordSchema.parse({
      ...base,
      roster: "SP27",
      lead: { netid: "al123", name: "Ada Lovelace", more: 1 },
    });
    expect(r.roster).toBe("SP27");
    expect(r.lead).toMatchObject({ netid: "al123", name: "Ada Lovelace", more: 1 });
  });

  it("a name-only lead (empty netid) is kept", () => {
    const r = CatalogIndexRecordSchema.parse({
      ...base,
      roster: "SP27",
      lead: { netid: "", name: "Charles Babbage", more: 0 },
    });
    expect(r.lead).toMatchObject({ netid: "", name: "Charles Babbage" });
  });

  it("an explicit null lead (staff / TBA) stays null", () => {
    expect(CatalogIndexRecordSchema.parse({ ...base, roster: "SP27", lead: null }).lead).toBeNull();
  });

  it("a malformed lead or roster degrades to null instead of failing the record", () => {
    const r = CatalogIndexRecordSchema.parse({
      ...base,
      roster: "WAY-TOO-LONG-SLUG",
      lead: { netid: "x".repeat(40), name: "Ada Lovelace", more: 1 },
    });
    expect(r.roster).toBeNull();
    expect(r.lead).toBeNull();
    expect(CatalogIndexRecordSchema.parse({ ...base, lead: { netid: "al123", name: "", more: 0 } }).lead).toBeNull();
    expect(CatalogIndexRecordSchema.parse({ ...base, lead: { netid: "al123", name: "A", more: 999 } }).lead).toBeNull();
    expect(CatalogIndexRecordSchema.parse({ ...base, lead: "nope", roster: 42 })).toMatchObject({
      lead: null,
      roster: null,
    });
  });

  it("one bad record's lead never fails the whole chunk", () => {
    const chunk = CatalogIndexChunkSchema.parse({
      records: [
        { ...base, roster: "SP27", lead: { netid: "al123", name: "Ada Lovelace", more: 0 } },
        { ...base, id: "CS-1110", roster: "SP27", lead: { netid: 7, name: null } },
      ],
    });
    expect(chunk.records.map((r) => r.lead?.name ?? null)).toEqual(["Ada Lovelace", null]);
  });
});

describe("ProfessorRatingsDocSchema — tolerant", () => {
  it("drops a malformed entry without failing the doc", () => {
    const doc = ProfessorRatingsDocSchema.parse({
      ratings: {
        al123: { r: 3.6, c: 20, t: "v", at: NOW },
        bad1: { r: 7, c: 20, t: "v", at: NOW },
        bad2: { r: 4, c: 3, t: "x", at: NOW },
        bad3: "nope",
        bad4: { r: null, c: 2, t: "p", at: NOW },
      },
      count: 5,
    });
    expect(Object.keys(doc.ratings)).toEqual(["al123"]);
  });

  it("a doc without ratings parses as empty", () => {
    expect(ProfessorRatingsDocSchema.parse({}).ratings).toEqual({});
  });
});

describe("ratingsFromDoc", () => {
  it("maps tiers and keeps fresh entries", () => {
    const m = ratingsFromDoc(
      {
        ratings: {
          al123: { r: 3.6, c: 20, t: "v", at: NOW - DAY },
          gh456: { r: 4.0, c: 8, t: "p", at: NOW - 10 * DAY },
        },
      },
      NOW
    );
    expect(m.get("al123")).toEqual({ rating: 3.6, count: 20, tier: "verified", fetchedAtMs: NOW - DAY });
    expect(m.get("gh456")?.tier).toBe("probable");
  });

  it("drops entries older than the panel's staleness cutoff", () => {
    const m = ratingsFromDoc(
      {
        ratings: {
          fresh: { r: 4, c: 9, t: "v", at: NOW - STALE_AFTER_DAYS * DAY },
          stale: { r: 4, c: 9, t: "v", at: NOW - (STALE_AFTER_DAYS + 1) * DAY },
        },
      },
      NOW
    );
    expect([...m.keys()]).toEqual(["fresh"]);
  });

  it("drops professors with no reviews (never a 0.0 ★)", () => {
    const m = ratingsFromDoc(
      {
        ratings: {
          none: { r: 0, c: 0, t: "v", at: NOW },
          zeroCount: { r: 4.5, c: 0, t: "v", at: NOW },
          zeroRating: { r: 0, c: 3, t: "v", at: NOW },
          ok: { r: 4.1, c: 3, t: "v", at: NOW },
        },
      },
      NOW
    );
    expect([...m.keys()]).toEqual(["ok"]);
  });

  it("an unparseable doc yields an empty map", () => {
    expect(ratingsFromDoc(null, NOW).size).toBe(0);
    expect(ratingsFromDoc({ ratings: "nope" }, NOW).size).toBe(0);
  });
});

describe("rowRating — the one join the row and the well-rated chip share", () => {
  const lead = { netid: "al123", name: "Ada Lovelace", more: 0 };
  const ratings = new Map([["al123", { rating: 4.2, count: 9, tier: "verified" as const, fetchedAtMs: NOW }]]);

  it("joins on the enrollment term or a labelable term", () => {
    expect(rowRating({ lead, roster: "SP27" }, "SP27", ratings)?.rating).toBe(4.2);
    expect(rowRating({ lead, roster: "FA26" }, "SP27", ratings)?.rating).toBe(4.2);
  });

  it("no roster, an unlabelable roster, or a name-only lead → no rating", () => {
    expect(rowRating({ lead, roster: null }, "SP27", ratings)).toBeNull();
    expect(rowRating({ lead, roster: "??" }, "SP27", ratings)).toBeNull();
    expect(rowRating({ lead: { ...lead, netid: "" }, roster: "SP27" }, "SP27", ratings)).toBeNull();
    // Even if the map somehow held an empty key, a name-only lead never matches.
    const withEmptyKey = new Map([["", { rating: 5, count: 99, tier: "verified" as const, fetchedAtMs: NOW }]]);
    expect(rowRating({ lead: { ...lead, netid: "" }, roster: "SP27" }, "SP27", withEmptyKey)).toBeNull();
  });
});

describe("isWellRated", () => {
  const lead = { netid: "al123", name: "Ada Lovelace", more: 0 };
  const rec = { lead, roster: "SP27" };
  const map = (rating: number, count: number, tier: "verified" | "probable" = "verified") =>
    new Map([["al123", { rating, count, tier, fetchedAtMs: NOW }]]);

  it("needs a verified rating of 4.0+ (as displayed) and 5+ reviews", () => {
    expect(isWellRated(rec, map(4.0, 5), "SP27")).toBe(true);
    expect(isWellRated(rec, map(3.95, 5), "SP27")).toBe(true);
    expect(isWellRated(rec, map(3.9, 50), "SP27")).toBe(false);
    expect(isWellRated(rec, map(4.8, 4), "SP27")).toBe(false);
    expect(isWellRated(rec, map(4.8, 50, "probable"), "SP27")).toBe(false);
  });

  it("no lead or no map fails", () => {
    expect(isWellRated({ lead: null, roster: "SP27" }, map(5, 50), "SP27")).toBe(false);
    expect(isWellRated(rec, undefined, "SP27")).toBe(false);
  });

  it("fails whenever the row would show no rating (agrees with the row)", () => {
    expect(isWellRated({ lead, roster: null }, map(5, 50), "SP27")).toBe(false);
    expect(isWellRated({ lead: { ...lead, netid: "" }, roster: "SP27" }, map(5, 50), "SP27")).toBe(false);
    expect(isWellRated({ lead, roster: "??" }, map(5, 50), "SP27")).toBe(false);
  });

  it("a labeled other-term row with a rating can pass, like the row shows it", () => {
    expect(isWellRated({ lead, roster: "FA26" }, map(4.5, 10), "SP27")).toBe(true);
  });

  it("displayedRating rounds to one decimal", () => {
    expect(displayedRating(3.95)).toBe(4);
    expect(displayedRating(3.94)).toBe(3.9);
  });
});
