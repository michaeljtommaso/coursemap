import { describe, it, expect } from "vitest";
import {
  evaluate,
  courseSatisfiesRequirement,
  matchesAttribute,
  normalizeAttributeMatch,
  patternToRegex,
  type EvalContext,
  type AttributeMatch,
} from "./satisfies";
import type { PrereqExpr } from "@/types/db";

// ── Tree builders ─────────────────────────────────────────────────────────────
const course = (id: string): PrereqExpr => ({ type: "course", id });
const pattern = (p: string): PrereqExpr => ({ type: "pattern", pattern: p });
const concurrent = (id: string): PrereqExpr => ({ type: "concurrent", id });
const and = (...children: PrereqExpr[]): PrereqExpr => ({ type: "and", children });
const or = (...children: PrereqExpr[]): PrereqExpr => ({ type: "or", children });
const advisory = (expr: PrereqExpr, note = "or equivalent AP credit"): PrereqExpr => ({
  type: "advisory",
  expr,
  note,
});

/** Context helper — completedIds/codes plus optional credit / concurrent pools. */
function ctx(opts: Partial<EvalContext> = {}): EvalContext {
  return {
    completedIds: opts.completedIds ?? new Set(),
    completedCodes: opts.completedCodes ?? new Set(),
    concurrentIds: opts.concurrentIds,
    creditIds: opts.creditIds,
    creditCodes: opts.creditCodes,
  };
}

describe("evaluate — null / trivial", () => {
  it("null expr → met with empty arrays", () => {
    expect(evaluate(null, ctx())).toEqual({
      state: "met",
      satisfiedBy: [],
      missing: [],
      advisoryNotes: [],
    });
    expect(evaluate(undefined, ctx())).toEqual({
      state: "met",
      satisfiedBy: [],
      missing: [],
      advisoryNotes: [],
    });
  });
});

describe("evaluate — and / or nesting", () => {
  it("AND met when every child met", () => {
    const expr = and(course("CS-1110"), course("MATH-1910"));
    const r = evaluate(expr, ctx({ completedIds: new Set(["CS-1110", "MATH-1910"]) }));
    expect(r.state).toBe("met");
    expect(new Set(r.satisfiedBy)).toEqual(new Set(["CS-1110", "MATH-1910"]));
    expect(r.missing).toEqual([]);
  });

  it("AND blocked surfaces only the failing child", () => {
    const expr = and(course("CS-1110"), course("MATH-1910"));
    const r = evaluate(expr, ctx({ completedIds: new Set(["CS-1110"]) }));
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["MATH-1910"]);
    expect(r.satisfiedBy).toEqual(["CS-1110"]);
  });

  it("OR met when any child met; missing empty", () => {
    const expr = or(course("CS-2800"), course("CS-2802"));
    const r = evaluate(expr, ctx({ completedIds: new Set(["CS-2802"]) }));
    expect(r.state).toBe("met");
    expect(r.missing).toEqual([]);
  });

  it("OR blocked surfaces every alternative", () => {
    const expr = or(course("CS-2800"), course("CS-2802"));
    const r = evaluate(expr, ctx());
    expect(r.state).toBe("blocked");
    expect(r.missing.sort()).toEqual(["CS-2800", "CS-2802"]);
  });

  it("nested and(or(...), course) blocks on the unmet AND-child", () => {
    const expr = and(or(course("A"), course("B")), course("C"));
    const r = evaluate(expr, ctx({ completedIds: new Set(["A"]) }));
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["C"]);
  });
});

describe("evaluate — pattern", () => {
  it("pattern met by a matching completed code", () => {
    const r = evaluate(pattern("CS-3xxx"), ctx({ completedCodes: new Set(["CS 3110"]) }));
    expect(r.state).toBe("met");
    expect(r.satisfiedBy).toEqual(["CS 3110"]);
  });

  it("pattern blocked renders in code form", () => {
    const r = evaluate(pattern("CS-3xxx"), ctx());
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["CS 3xxx"]);
  });
});

describe("evaluate — concurrent", () => {
  it("satisfiable-by-definition when no concurrent pool is provided", () => {
    const r = evaluate(concurrent("PHYS-1110"), ctx());
    expect(r.state).toBe("met");
    // No real evidence → not listed in satisfiedBy.
    expect(r.satisfiedBy).toEqual([]);
  });

  it("met by a concurrent-pool member (listed as evidence)", () => {
    const r = evaluate(
      concurrent("PHYS-1110"),
      ctx({ concurrentIds: new Set(["PHYS-1110"]) })
    );
    expect(r.state).toBe("met");
    expect(r.satisfiedBy).toEqual(["PHYS-1110"]);
  });

  it("blocked when a concurrent pool exists without the course", () => {
    const r = evaluate(
      concurrent("PHYS-1110"),
      ctx({ concurrentIds: new Set(["CHEM-2090"]) })
    );
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["PHYS-1110"]);
  });
});

describe("evaluate — advisory", () => {
  it("advisory-only tree, inner unsatisfied → advisory + note listed, not blocked", () => {
    const r = evaluate(advisory(course("MATH-1910")), ctx());
    expect(r.state).toBe("advisory");
    expect(r.advisoryNotes).toEqual(["or equivalent AP credit"]);
    expect(r.missing).toEqual([]); // advisory contributes nothing to missing
  });

  it("advisory satisfied → met, no notes", () => {
    const r = evaluate(
      advisory(course("MATH-1910")),
      ctx({ completedIds: new Set(["MATH-1910"]) })
    );
    expect(r.state).toBe("met");
    expect(r.advisoryNotes).toEqual([]);
  });

  it("hard-fail alongside an unsatisfied advisory → blocked AND note still reported", () => {
    const expr = and(course("CS-2800"), advisory(course("MATH-1910")));
    const r = evaluate(expr, ctx()); // neither present
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["CS-2800"]); // advisory never contributes
    expect(r.advisoryNotes).toEqual(["or equivalent AP credit"]);
  });

  it("advisory sibling satisfied inside a blocked AND → no note", () => {
    const expr = and(course("CS-2800"), advisory(course("MATH-1910")));
    const r = evaluate(expr, ctx({ completedIds: new Set(["MATH-1910"]) }));
    expect(r.state).toBe("blocked");
    expect(r.missing).toEqual(["CS-2800"]);
    expect(r.advisoryNotes).toEqual([]);
  });
});

describe("evaluate — credit pool (spec 007 §2)", () => {
  it("credit id satisfies a course leaf → met, satisfiedBy contains the credit id", () => {
    const r = evaluate(
      course("MATH-1910"),
      ctx({ creditIds: new Set(["MATH-1910"]) })
    );
    expect(r.state).toBe("met");
    expect(r.satisfiedBy).toContain("MATH-1910");
    expect(r.missing).toEqual([]);
  });

  it("credit code satisfies a pattern leaf", () => {
    const r = evaluate(
      pattern("MATH-19xx"),
      ctx({ creditCodes: new Set(["MATH 1910"]) })
    );
    expect(r.state).toBe("met");
    expect(r.satisfiedBy).toEqual(["MATH 1910"]);
  });

  it("credit collapses an advisory to met (the MATH 1920 story)", () => {
    // MATH 1920's real shape: prereq = advisory(course(MATH-1910)).
    const expr = advisory(course("MATH-1910"));
    const withCredit = evaluate(expr, ctx({ creditIds: new Set(["MATH-1910"]) }));
    expect(withCredit.state).toBe("met");
    expect(withCredit.advisoryNotes).toEqual([]);

    const withoutCredit = evaluate(expr, ctx());
    expect(withoutCredit.state).toBe("advisory");
    expect(withoutCredit.advisoryNotes).toEqual(["or equivalent AP credit"]);
  });
});

describe("courseSatisfiesRequirement", () => {
  const cs2110 = { id: "CS-2110", subject: "CS", number: "2110" };

  it("course kind — exact id match", () => {
    expect(courseSatisfiesRequirement(cs2110, { kind: "course", courseId: "CS-2110" })).toBe(true);
    expect(courseSatisfiesRequirement(cs2110, { kind: "course", courseId: "CS-2112" })).toBe(false);
  });

  it("course kind — alias canonicalization (ENGRD-2110 ≡ CS-2110)", () => {
    const canonical = (id: string) => (id === "ENGRD-2110" ? "CS-2110" : id);
    const engrd = { id: "ENGRD-2110", subject: "ENGRD", number: "2110" };
    expect(
      courseSatisfiesRequirement(engrd, { kind: "course", courseId: "CS-2110" }, canonical)
    ).toBe(true);
    // Without the canonical map, the raw ids differ → no match.
    expect(courseSatisfiesRequirement(engrd, { kind: "course", courseId: "CS-2110" })).toBe(false);
  });

  it("pattern kind — subject+number tested against the regex", () => {
    expect(courseSatisfiesRequirement(cs2110, { kind: "pattern", pattern: "CS-2xxx" })).toBe(true);
    expect(courseSatisfiesRequirement(cs2110, { kind: "pattern", pattern: "MATH-2xxx" })).toBe(false);
  });

  // ── Attribute kind (spec 010 §2) ──────────────────────────────────────────
  const FWS: AttributeMatch = { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] };

  it("attribute kind — title startsWith hit/miss", () => {
    const fwsCourse = { id: "ENGL-1105", subject: "ENGL", number: "1105", title: "FWS: Cultures of the Middle Ages" };
    const other = { id: "CS-2110", subject: "CS", number: "2110", title: "Object-Oriented Programming" };
    expect(courseSatisfiesRequirement(fwsCourse, { kind: "attribute", match: FWS })).toBe(true);
    expect(courseSatisfiesRequirement(other, { kind: "attribute", match: FWS })).toBe(false);
  });

  it("attribute kind — attrs.value 'in' hit/miss", () => {
    const match: AttributeMatch = { anyOf: [{ field: "attrs.value", op: "in", value: ["WRT-AG", "ALC-AS"] }] };
    const tagged = {
      id: "ENGL-2000", subject: "ENGL", number: "2000", title: "Some Course",
      attrs: [{ value: "ALC-AS" }],
    };
    const untagged = {
      id: "CS-2110", subject: "CS", number: "2110", title: "OOP",
      attrs: [{ value: "SBA-AS" }],
    };
    expect(courseSatisfiesRequirement(tagged, { kind: "attribute", match })).toBe(true);
    expect(courseSatisfiesRequirement(untagged, { kind: "attribute", match })).toBe(false);
  });

  it("attribute kind — anyOf is an OR across predicates", () => {
    const match: AttributeMatch = {
      anyOf: [
        { field: "title", op: "startsWith", value: "FWS:" },
        { field: "attrs.value", op: "in", value: ["WRT-AG"] },
      ],
    };
    const byTitle = { id: "A-1", subject: "A", number: "1", title: "FWS: Writing", attrs: [] };
    const byAttr = { id: "B-2", subject: "B", number: "2", title: "Plain", attrs: [{ value: "WRT-AG" }] };
    const neither = { id: "C-3", subject: "C", number: "3", title: "Plain", attrs: [{ value: "SBA-AS" }] };
    expect(courseSatisfiesRequirement(byTitle, { kind: "attribute", match })).toBe(true);
    expect(courseSatisfiesRequirement(byAttr, { kind: "attribute", match })).toBe(true);
    expect(courseSatisfiesRequirement(neither, { kind: "attribute", match })).toBe(false);
  });

  it("attribute kind — missing title/attrs return false, never throw", () => {
    // A pool ref carrying only id/subject/number (no title/attrs).
    const bare = { id: "ENGL-1105", subject: "ENGL", number: "1105" };
    expect(courseSatisfiesRequirement(bare, { kind: "attribute", match: FWS })).toBe(false);
    const attrReq: AttributeMatch = { anyOf: [{ field: "attrs.value", op: "in", value: ["WRT-AG"] }] };
    expect(courseSatisfiesRequirement(bare, { kind: "attribute", match: attrReq })).toBe(false);
  });

  it("attribute kind — the majors-panel pool scenario (pool course title matches)", () => {
    // useMajorMatch builds { kind:'attribute', match } and tests each pool ref;
    // a placed FWS course (full title carried) satisfies the FWS requirement.
    const poolRef = { id: "ENGL-1170", subject: "ENGL", number: "1170", title: "FWS: Short Stories", attrs: [] };
    const hit = [poolRef].some((ref) => courseSatisfiesRequirement(ref, { kind: "attribute", match: FWS }));
    expect(hit).toBe(true);
  });
});

describe("matchesAttribute — index/flag paths", () => {
  const FWS: AttributeMatch = { anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }] };

  it("uses the derived fws flag for the FWS: predicate when present", () => {
    expect(matchesAttribute({ fws: true }, FWS)).toBe(true);
    expect(matchesAttribute({ fws: false }, FWS)).toBe(false);
    // Flag wins over a (hypothetically stale) title when both are present.
    expect(matchesAttribute({ fws: false, title: "FWS: X" }, FWS)).toBe(false);
  });

  it("falls back to the title when no fws flag is supplied", () => {
    expect(matchesAttribute({ title: "FWS: Poetry" }, FWS)).toBe(true);
    expect(matchesAttribute({ title: "Intro to Poetry" }, FWS)).toBe(false);
    expect(matchesAttribute({}, FWS)).toBe(false);
  });

  it("attrs.value 'in' tests the supplied attr values", () => {
    const m: AttributeMatch = { anyOf: [{ field: "attrs.value", op: "in", value: ["ALC-AS"] }] };
    expect(matchesAttribute({ attrValues: ["ALC-AS", "SBA-AS"] }, m)).toBe(true);
    expect(matchesAttribute({ attrValues: ["SBA-AS"] }, m)).toBe(false);
    expect(matchesAttribute({ attrValues: [] }, m)).toBe(false);
    expect(matchesAttribute({}, m)).toBe(false);
  });
});

describe("normalizeAttributeMatch", () => {
  it("keeps valid title + attrs.value predicates", () => {
    const raw = {
      anyOf: [
        { field: "title", op: "startsWith", value: "FWS:" },
        { field: "attrs.value", op: "in", value: ["WRT-AG", "ALC-AS"] },
      ],
    };
    expect(normalizeAttributeMatch(raw)).toEqual(raw);
  });

  it("drops unknown predicate shapes but keeps the valid ones", () => {
    const raw = {
      anyOf: [
        { field: "title", op: "startsWith", value: "FWS:" },
        { field: "credits", op: "gte", value: 3 }, // unknown → dropped
        { field: "attrs.value", op: "in", value: [1, 2] }, // non-string values → dropped
      ],
    };
    expect(normalizeAttributeMatch(raw)).toEqual({
      anyOf: [{ field: "title", op: "startsWith", value: "FWS:" }],
    });
  });

  it("normalizes malformed/empty shapes to null", () => {
    expect(normalizeAttributeMatch(null)).toBeNull();
    expect(normalizeAttributeMatch(undefined)).toBeNull();
    expect(normalizeAttributeMatch({})).toBeNull();
    expect(normalizeAttributeMatch({ anyOf: [] })).toBeNull();
    expect(normalizeAttributeMatch({ anyOf: "nope" })).toBeNull();
    expect(normalizeAttributeMatch({ anyOf: [{ field: "title" }] })).toBeNull();
    expect(normalizeAttributeMatch("FWS:")).toBeNull();
  });
});

describe("patternToRegex", () => {
  it("x and * are single-char wildcards; dashes normalize to spaces", () => {
    expect(patternToRegex("CS-111x").test("CS 1110")).toBe(true);
    expect(patternToRegex("CS-111x").test("CS 1112")).toBe(true);
    expect(patternToRegex("CS-111x").test("CS 2110")).toBe(false);
  });
});
