import { describe, it, expect, vi } from "vitest";
import {
  TARGET_FILTER_STORAGE_KEY,
  formatRosterTerm,
  initialTargetFilterOn,
  leadLine,
  saveTargetFilterChoice,
  selectDirectoryResults,
} from "./targetFilter";
import type { ProfessorRating } from "./professorRatings";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("formatRosterTerm", () => {
  it("formats roster slugs", () => {
    expect(formatRosterTerm("SP27")).toBe("Spring 2027");
    expect(formatRosterTerm("FA26")).toBe("Fall 2026");
    expect(formatRosterTerm("SU26")).toBe("Summer 2026");
  });
  it("returns null for missing or malformed slugs", () => {
    expect(formatRosterTerm(null)).toBeNull();
    expect(formatRosterTerm("Spring")).toBeNull();
    expect(formatRosterTerm("XX27")).toBeNull();
  });
});

describe("term-keyed persistence (spec 017 D3)", () => {
  it("defaults on with nothing stored", () => {
    expect(initialTargetFilterOn(memoryStorage(), "SP27")).toBe(true);
  });

  it("turning off stores { target, on: false } and is honored for the same target", () => {
    const s = memoryStorage();
    saveTargetFilterChoice(s, "SP27", false);
    expect(JSON.parse(s.data.get(TARGET_FILTER_STORAGE_KEY)!)).toEqual({ target: "SP27", on: false });
    expect(initialTargetFilterOn(s, "SP27")).toBe(false);
  });

  it("a stored off for an older target no longer applies", () => {
    const s = memoryStorage({
      [TARGET_FILTER_STORAGE_KEY]: JSON.stringify({ target: "SP27", on: false }),
    });
    expect(initialTargetFilterOn(s, "FA27")).toBe(true);
  });

  it("turning back on clears the stored choice", () => {
    const s = memoryStorage();
    saveTargetFilterChoice(s, "SP27", false);
    saveTargetFilterChoice(s, "SP27", true);
    expect(s.data.has(TARGET_FILTER_STORAGE_KEY)).toBe(false);
    expect(initialTargetFilterOn(s, "SP27")).toBe(true);
  });

  it("malformed, unavailable, or throwing storage falls back to on and never throws", () => {
    expect(initialTargetFilterOn(memoryStorage({ [TARGET_FILTER_STORAGE_KEY]: "{oops" }), "SP27")).toBe(true);
    expect(
      initialTargetFilterOn(
        memoryStorage({ [TARGET_FILTER_STORAGE_KEY]: JSON.stringify({ target: "SP27", on: "no" }) }),
        "SP27"
      )
    ).toBe(true);
    expect(initialTargetFilterOn(null, "SP27")).toBe(true);
    expect(initialTargetFilterOn(throwing, "SP27")).toBe(true);
    expect(() => saveTargetFilterChoice(throwing, "SP27", false)).not.toThrow();
    expect(() => saveTargetFilterChoice(null, "SP27", false)).not.toThrow();
  });

  it("no target → on (the page hides the switch anyway)", () => {
    expect(initialTargetFilterOn(memoryStorage(), null)).toBe(true);
  });
});

describe("selectDirectoryResults — search fallback (spec 017 D1)", () => {
  it("keeps the target-roster results when there are any", () => {
    const others = vi.fn(() => ["x"]);
    expect(selectDirectoryResults(["a"], { targetOn: true, query: "thermo", others })).toEqual({
      rows: ["a"],
      notOnTarget: false,
    });
    expect(others).not.toHaveBeenCalled();
  });

  it("falls back to other matches, flagged, when the target roster has none", () => {
    expect(
      selectDirectoryResults<string>([], { targetOn: true, query: "thermo", others: () => ["b", "c"] })
    ).toEqual({ rows: ["b", "c"], notOnTarget: true });
  });

  it("stays empty when nothing matches anywhere", () => {
    expect(selectDirectoryResults<string>([], { targetOn: true, query: "zzz", others: () => [] })).toEqual({
      rows: [],
      notOnTarget: false,
    });
  });

  it("never falls back with the switch off or an empty query", () => {
    const others = vi.fn(() => ["b"]);
    expect(selectDirectoryResults<string>([], { targetOn: false, query: "thermo", others }).notOnTarget).toBe(
      false
    );
    expect(selectDirectoryResults<string>([], { targetOn: true, query: "  ", others }).notOnTarget).toBe(false);
    expect(others).not.toHaveBeenCalled();
  });
});

describe("leadLine (spec 017 D4)", () => {
  const lead = { netid: "df64", name: "Daisy Fan", more: 1 };
  const rating = (over: Partial<ProfessorRating> = {}): ProfessorRating => ({
    rating: 3.6,
    count: 20,
    tier: "verified",
    fetchedAtMs: 0,
    ...over,
  });
  const ratings = new Map([["df64", rating()]]);

  it("target-roster course: name, rating, +N, no label", () => {
    expect(leadLine({ lead, roster: "SP27" }, "SP27", ratings)).toEqual({
      termLabel: null,
      name: "Daisy Fan",
      rating: "3.6 ★",
      probable: false,
      more: 1,
    });
  });

  it("other-roster course: same rating behind a term label", () => {
    const l = leadLine({ lead, roster: "FA26" }, "SP27", ratings);
    expect(l?.termLabel).toBe("Fall 2026");
    expect(l?.rating).toBe("3.6 ★");
  });

  it("probable match is flagged", () => {
    const l = leadLine({ lead, roster: "SP27" }, "SP27", new Map([["df64", rating({ tier: "probable" })]]));
    expect(l?.probable).toBe(true);
  });

  it("no live rating → name only", () => {
    const l = leadLine({ lead, roster: "SP27" }, "SP27", new Map());
    expect(l?.rating).toBeNull();
    expect(l?.name).toBe("Daisy Fan");
  });

  it("unknown roster → name only, never a bare rating", () => {
    const l = leadLine({ lead, roster: null }, "SP27", ratings);
    expect(l?.termLabel).toBeNull();
    expect(l?.rating).toBeNull();
  });

  it("no lead → no line", () => {
    expect(leadLine({ lead: null, roster: "SP27" }, "SP27", ratings)).toBeNull();
  });
});
