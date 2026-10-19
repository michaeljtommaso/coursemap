import { describe, it, expect } from "vitest";
import {
  CatalogIndexChunkSchema,
  CatalogIndexRecordSchema,
  ProfessorRatingsDocSchema,
} from "@/lib/schemas";
import { STALE_AFTER_DAYS } from "@/lib/planner/reviews";
import { ratingsFromDoc, isWellRated, displayedRating } from "./professorRatings";

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
      lead: { netid: "df64", name: "Daisy Fan", more: 1 },
    });
    expect(r.roster).toBe("SP27");
    expect(r.lead).toMatchObject({ netid: "df64", name: "Daisy Fan", more: 1 });
  });

  it("an explicit null lead (staff / TBA) stays null", () => {
    expect(CatalogIndexRecordSchema.parse({ ...base, roster: "SP27", lead: null }).lead).toBeNull();
  });
});

describe("ProfessorRatingsDocSchema — tolerant", () => {
  it("drops a malformed entry without failing the doc", () => {
    const doc = ProfessorRatingsDocSchema.parse({
      ratings: {
        df64: { r: 3.6, c: 20, t: "v", at: NOW },
        bad1: { r: 7, c: 20, t: "v", at: NOW },
        bad2: { r: 4, c: 3, t: "x", at: NOW },
        bad3: "nope",
        bad4: { r: null, c: 2, t: "p", at: NOW },
      },
      count: 5,
    });
    expect(Object.keys(doc.ratings)).toEqual(["df64"]);
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
          df64: { r: 3.6, c: 20, t: "v", at: NOW - DAY },
          mg12: { r: 4.0, c: 8, t: "p", at: NOW - 10 * DAY },
        },
      },
      NOW
    );
    expect(m.get("df64")).toEqual({ rating: 3.6, count: 20, tier: "verified", fetchedAtMs: NOW - DAY });
    expect(m.get("mg12")?.tier).toBe("probable");
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

  it("an unparseable doc yields an empty map", () => {
    expect(ratingsFromDoc(null, NOW).size).toBe(0);
    expect(ratingsFromDoc({ ratings: "nope" }, NOW).size).toBe(0);
  });
});

describe("isWellRated", () => {
  const lead = { netid: "df64", name: "Daisy Fan", more: 0 };
  const map = (rating: number, count: number, tier: "verified" | "probable" = "verified") =>
    new Map([["df64", { rating, count, tier, fetchedAtMs: NOW }]]);

  it("needs a verified rating of 4.0+ (as displayed) and 5+ reviews", () => {
    expect(isWellRated(lead, map(4.0, 5))).toBe(true);
    expect(isWellRated(lead, map(3.95, 5))).toBe(true);
    expect(isWellRated(lead, map(3.9, 50))).toBe(false);
    expect(isWellRated(lead, map(4.8, 4))).toBe(false);
    expect(isWellRated(lead, map(4.8, 50, "probable"))).toBe(false);
  });

  it("no lead or no map fails", () => {
    expect(isWellRated(null, map(5, 50))).toBe(false);
    expect(isWellRated(lead, undefined)).toBe(false);
  });

  it("displayedRating rounds to one decimal", () => {
    expect(displayedRating(3.95)).toBe(4);
    expect(displayedRating(3.94)).toBe(3.9);
  });
});
