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
  const row = (id: string, roster: string | null) => ({ id, roster });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("keeps the target-roster results when there are any", () => {
    const others = vi.fn(() => [row("x", "FA26")]);
    const out = selectDirectoryResults([row("a", "SP27")], { targetOn: true, query: "thermo", target: "SP27", others });
    expect(ids(out.rows)).toEqual(["a"]);
    expect(out.notOnTarget).toBe(false);
    expect(others).not.toHaveBeenCalled();
  });

  it("falls back to other matches with a KNOWN other roster, flagged", () => {
    const out = selectDirectoryResults([], {
      targetOn: true,
      query: "thermo",
      target: "SP27",
      others: () => [row("b", "FA26"), row("c", "SU26")],
    });
    expect(ids(out.rows)).toEqual(["b", "c"]);
    expect(out.notOnTarget).toBe(true);
  });

  it("never labels a course with no roster on record as 'not offered'", () => {
    const out = selectDirectoryResults([], {
      targetOn: true,
      query: "thermo",
      target: "SP27",
      others: () => [row("b", "FA26"), row("unknown", null)],
    });
    expect(ids(out.rows)).toEqual(["b"]);
    expect(out.notOnTarget).toBe(true);
  });

  it("stays empty (unflagged) when only roster-less courses match", () => {
    const out = selectDirectoryResults([], {
      targetOn: true,
      query: "thermo",
      target: "SP27",
      others: () => [row("unknown", null)],
    });
    expect(out).toEqual({ rows: [], notOnTarget: false });
  });

  it("stays empty when nothing matches anywhere", () => {
    expect(
      selectDirectoryResults<{ id: string; roster: string | null }>([], {
        targetOn: true,
        query: "zzz",
        target: "SP27",
        others: () => [],
      })
    ).toEqual({ rows: [], notOnTarget: false });
  });

  it("never falls back with the switch off, an empty query, or no target", () => {
    const others = vi.fn(() => [row("b", "FA26")]);
    const opts = { targetOn: true, query: "thermo", target: "SP27" as string | null, others };
    expect(selectDirectoryResults([], { ...opts, targetOn: false }).notOnTarget).toBe(false);
    expect(selectDirectoryResults([], { ...opts, query: "  " }).notOnTarget).toBe(false);
    expect(selectDirectoryResults([], { ...opts, target: null }).notOnTarget).toBe(false);
    expect(others).not.toHaveBeenCalled();
  });
});

describe("leadLine (spec 017 D4)", () => {
  const lead = { netid: "al123", name: "Ada Lovelace", more: 1 };
  const rating = (over: Partial<ProfessorRating> = {}): ProfessorRating => ({
    rating: 3.6,
    count: 20,
    tier: "verified",
    fetchedAtMs: 0,
    ...over,
  });
  const ratings = new Map([["al123", rating()]]);

  it("target-roster course: name, rating, +N, no label", () => {
    expect(leadLine({ lead, roster: "SP27" }, "SP27", ratings)).toEqual({
      termLabel: null,
      name: "Ada Lovelace",
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
    const l = leadLine({ lead, roster: "SP27" }, "SP27", new Map([["al123", rating({ tier: "probable" })]]));
    expect(l?.probable).toBe(true);
  });

  it("no live rating → name only", () => {
    const l = leadLine({ lead, roster: "SP27" }, "SP27", new Map());
    expect(l?.rating).toBeNull();
    expect(l?.name).toBe("Ada Lovelace");
  });

  it("unknown roster → name only, never a bare rating", () => {
    const l = leadLine({ lead, roster: null }, "SP27", ratings);
    expect(l?.termLabel).toBeNull();
    expect(l?.rating).toBeNull();
  });

  it("name-only lead (empty netid) → name only, never joined to a rating", () => {
    const l = leadLine(
      { lead: { netid: "", name: "Charles Babbage", more: 0 }, roster: "SP27" },
      "SP27",
      new Map([["", rating({ rating: 5 })]])
    );
    expect(l?.name).toBe("Charles Babbage");
    expect(l?.rating).toBeNull();
  });

  it("no lead → no line", () => {
    expect(leadLine({ lead: null, roster: "SP27" }, "SP27", ratings)).toBeNull();
  });
});
