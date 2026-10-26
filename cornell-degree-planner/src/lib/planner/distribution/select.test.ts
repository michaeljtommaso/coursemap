import { describe, it, expect } from "vitest";
import { LayerSchema } from "@/lib/schemas";
import { appliesToMatches, clauseMatches, selectLayers, termOrdinal } from "./select";
import type { ClassStanding, Layer, StudentContext, TransferKind } from "./types";
import casJson from "./fixtures/cas-college.json";
import cals2025Json from "./fixtures/cals-college-2025.json";
import calsPreJson from "./fixtures/cals-college-pre2025.json";

const cas = LayerSchema.parse(casJson) as Layer;
const cals2025 = LayerSchema.parse(cals2025Json) as Layer;
const calsPre = LayerSchema.parse(calsPreJson) as Layer;

const layer = (over: Partial<Layer>): Layer => ({
  id: "x",
  kind: "college",
  family: "cals",
  name: "X",
  catalogYear: "2026-27",
  rows: [],
  ...over,
});

const ctx = (over: Partial<StudentContext> = {}): StudentContext => ({ programId: "test-major", ...over });

describe("termOrdinal", () => {
  it("orders seasons within a year as WI < SP < SU < FA", () => {
    const order = ["WI25", "SP25", "SU25", "FA25", "WI26", "SP26"].map((t) => termOrdinal(t)!);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("orders across years", () => {
    expect(termOrdinal("FA24")!).toBeLessThan(termOrdinal("WI25")!);
    expect(termOrdinal("SP27")!).toBeGreaterThan(termOrdinal("FA26")!);
  });

  it.each(["", "FA2025", "fa25", "AU25", "FA5", "FA25 ", "XX99"])("rejects malformed %j", (t) => {
    expect(termOrdinal(t)).toBeNull();
  });
});

describe("clauseMatches / appliesToMatches", () => {
  it("enteredFrom is inclusive and enteredBefore exclusive", () => {
    const c = { enteredFrom: "FA25", enteredBefore: "FA26" };
    expect(clauseMatches(c, ctx({ entryTerm: "SU25" }))).toBe(false);
    expect(clauseMatches(c, ctx({ entryTerm: "FA25" }))).toBe(true);
    expect(clauseMatches(c, ctx({ entryTerm: "SP26" }))).toBe(true);
    expect(clauseMatches(c, ctx({ entryTerm: "SU26" }))).toBe(true);
    expect(clauseMatches(c, ctx({ entryTerm: "FA26" }))).toBe(false);
  });

  it("a clause with an entry-term field never matches an unknown entry term", () => {
    expect(clauseMatches({ enteredBefore: "FA99" }, ctx())).toBe(false);
    expect(clauseMatches({ enteredBefore: "FA99" }, ctx({ entryTerm: null }))).toBe(false);
    expect(clauseMatches({ enteredFrom: "FA00" }, ctx({ entryTerm: "bogus" }))).toBe(false);
  });

  it("transfer and standing must contain the student's value; unknown never matches", () => {
    expect(clauseMatches({ transfer: ["external"] }, ctx({ transfer: "external" }))).toBe(true);
    expect(clauseMatches({ transfer: ["external"] }, ctx({ transfer: "internal" }))).toBe(false);
    expect(clauseMatches({ transfer: ["none", "external", "internal"] }, ctx())).toBe(false);
    expect(clauseMatches({ transferStanding: ["junior"] }, ctx({ transferStanding: "junior" }))).toBe(true);
    expect(clauseMatches({ transferStanding: ["junior"] }, ctx({ transferStanding: null }))).toBe(false);
  });

  it("an empty clause matches everyone", () => {
    expect(clauseMatches({}, ctx())).toBe(true);
  });

  it("clauses are OR'd and an absent list applies to all", () => {
    const clauses = [{ enteredBefore: "FA25" }, { transfer: ["external" as TransferKind] }];
    expect(appliesToMatches(clauses, ctx({ entryTerm: "FA24" }))).toBe(true);
    expect(appliesToMatches(clauses, ctx({ entryTerm: "FA26", transfer: "external" }))).toBe(true);
    expect(appliesToMatches(clauses, ctx({ entryTerm: "FA26", transfer: "none" }))).toBe(false);
    expect(appliesToMatches(undefined, ctx())).toBe(true);
  });
});

describe("selectLayers — structure", () => {
  const major = layer({ id: "cals-major", kind: "major", programId: "test-major" });
  const otherMajor = layer({ id: "cals-other", kind: "major", programId: "other-major" });
  const conc = layer({ id: "cals-major--c1", kind: "concentration", programId: "test-major", concentrationId: "c1" });
  const casMajor = layer({ id: "cas-major", kind: "major", family: "cas", programId: "test-major" });

  it("orders college, major, concentration and stays inside the family", () => {
    const r = selectLayers([conc, casMajor, otherMajor, major, cals2025, calsPre, cas], {
      family: "cals",
      ...ctx({ entryTerm: "FA26", transfer: "none", concentrationId: "c1" }),
    });
    expect(r.problem).toBeUndefined();
    expect(r.layers.map((l) => l.id)).toEqual(["cals-college-2025", "cals-major", "cals-major--c1"]);
  });

  it("omits the concentration when none is chosen", () => {
    const r = selectLayers([conc, major, cals2025, calsPre], { family: "cals", ...ctx({ entryTerm: "FA26", transfer: "none" }) });
    expect(r.layers.map((l) => l.id)).toEqual(["cals-college-2025", "cals-major"]);
  });

  it("CAS has one unversioned college layer and needs no entry term", () => {
    const r = selectLayers([cas, casMajor], { family: "cas", ...ctx() });
    expect(r.problem).toBeUndefined();
    expect(r.layers.map((l) => l.id)).toEqual(["cas-college", "cas-major"]);
  });

  it("asks for the entry term when a version depends on it, returning no college layer", () => {
    const r = selectLayers([cals2025, calsPre, major], { family: "cals", ...ctx({ transfer: "none" }) });
    expect(r.problem).toBe("needs-entry-term");
    expect(r.layers.map((l) => l.id)).toEqual(["cals-major"]);
  });

  it("reports a missing major layer", () => {
    const r = selectLayers([cas], { family: "cas", ...ctx() });
    expect(r.problem).toBe("no-major-layer");
    expect(r.layers.map((l) => l.id)).toEqual(["cas-college"]);
  });

  it("reports no college layer for the family", () => {
    const r = selectLayers([major], { family: "cals", ...ctx({ entryTerm: "FA26" }) });
    expect(r.problem).toBe("no-college-layer");
  });

  it("reports no college layer when nothing matches and there is no default version", () => {
    const r = selectLayers([calsPre, major], { family: "cals", ...ctx({ entryTerm: "FA27", transfer: "none" }) });
    expect(r.problem).toBe("no-college-layer");
    expect(r.layers.map((l) => l.id)).toEqual(["cals-major"]);
  });

  it("reports two matching versions as ambiguous", () => {
    const a = layer({ id: "a", appliesTo: [{ enteredBefore: "FA30" }] });
    const b = layer({ id: "b", appliesTo: [{ enteredFrom: "FA20" }] });
    const r = selectLayers([a, b, major], { family: "cals", ...ctx({ entryTerm: "FA25" }) });
    expect(r.problem).toBe("ambiguous-college-layer");
  });

  it("reports two default versions as ambiguous", () => {
    const a = layer({ id: "a" });
    const b = layer({ id: "b" });
    const r = selectLayers([a, b, major], { family: "cals", ...ctx() });
    expect(r.problem).toBe("ambiguous-college-layer");
  });
});

describe("selectLayers — CALS entry-term versions", () => {
  const all = [cals2025, calsPre, cas, layer({ id: "cals-major", kind: "major", programId: "test-major" })];
  const pick = (over: Partial<StudentContext>) => {
    const r = selectLayers(all, { family: "cals", ...ctx(over) });
    const college = r.layers.filter((l) => l.kind === "college");
    return { problem: r.problem, ids: college.map((l) => l.id) };
  };

  it.each<[string, Partial<StudentContext>, string]>([
    ["first-year entering Spring 2024", { entryTerm: "SP24", transfer: "none" }, "cals-college-pre2025"],
    ["first-year entering Fall 2024", { entryTerm: "FA24", transfer: "none" }, "cals-college-pre2025"],
    ["summer 2025 entrant (before Fall 2025)", { entryTerm: "SU25", transfer: "none" }, "cals-college-pre2025"],
    ["first-year entering Fall 2025", { entryTerm: "FA25", transfer: "none" }, "cals-college-2025"],
    ["external transfer entering Fall 2025 as a sophomore", { entryTerm: "FA25", transfer: "external", transferStanding: "sophomore" }, "cals-college-pre2025"],
    ["external transfer entering Fall 2025 as a junior", { entryTerm: "FA25", transfer: "external", transferStanding: "junior" }, "cals-college-pre2025"],
    ["first-year entering Spring 2026", { entryTerm: "SP26", transfer: "none" }, "cals-college-2025"],
    ["first-year entering Fall 2026", { entryTerm: "FA26", transfer: "none" }, "cals-college-2025"],
    ["junior external transfer entering Fall 2026", { entryTerm: "FA26", transfer: "external", transferStanding: "junior" }, "cals-college-pre2025"],
    ["junior internal transfer entering Fall 2026 (already a Cornell student; internal moves follow their first term)", { entryTerm: "FA26", transfer: "internal", transferStanding: "junior" }, "cals-college-2025"],
    ["sophomore external transfer entering Spring 2026", { entryTerm: "SP26", transfer: "external", transferStanding: "sophomore" }, "cals-college-pre2025"],
    ["junior external transfer entering Spring 2026", { entryTerm: "SP26", transfer: "external", transferStanding: "junior" }, "cals-college-pre2025"],
    ["sophomore external transfer entering Fall 2026", { entryTerm: "FA26", transfer: "external", transferStanding: "sophomore" }, "cals-college-2025"],
    ["junior external transfer entering Spring 2027", { entryTerm: "SP27", transfer: "external", transferStanding: "junior" }, "cals-college-pre2025"],
    ["junior external transfer entering Fall 2027", { entryTerm: "FA27", transfer: "external", transferStanding: "junior" }, "cals-college-2025"],
  ])("%s → %s", (_name, over, expected) => {
    expect(pick(over)).toEqual({ problem: undefined, ids: [expected] });
  });

  it("an unknown entry term asks for one", () => {
    expect(pick({ transfer: "none" })).toEqual({ problem: "needs-entry-term", ids: [] });
  });

  // The pre-2025 section's own scope sentence (2026-27 catalog), restated as an
  // oracle: everyone who started at Cornell before Fall 2025, plus transfer
  // students who start as sophomores before Fall 2026 or as juniors before
  // Fall 2027.
  // `undefined` = the answer depends on a field the student hasn't given.
  const versionKnown = (t: number, transfer: TransferKind, standing: ClassStanding) => {
    if (t < termOrdinal("FA25")!) return "cals-college-pre2025";
    if (transfer !== "external") return "cals-college-2025";
    if (standing === "sophomore" && t < termOrdinal("FA26")!) return "cals-college-pre2025";
    if (standing === "junior" && t < termOrdinal("FA27")!) return "cals-college-pre2025";
    return "cals-college-2025";
  };
  const expectedVersion = (term: string, transfer: TransferKind | null, standing: ClassStanding | null) => {
    const t = termOrdinal(term)!;
    const ts: TransferKind[] = transfer ? [transfer] : ["none", "external", "internal"];
    const ss: ClassStanding[] = standing ? [standing] : ["first-year", "sophomore", "junior", "senior"];
    const outcomes = new Set(ts.flatMap((tr) => ss.map((st) => versionKnown(t, tr, st))));
    return outcomes.size === 1 ? [...outcomes][0] : undefined;
  };

  it("gives exactly one college version to every student in the grid (SP24…FA27 × transfer × standing)", () => {
    const terms: string[] = [];
    for (const y of [24, 25, 26, 27]) for (const s of ["WI", "SP", "SU", "FA"]) terms.push(`${s}${y}`);
    const transfers: (TransferKind | null)[] = [null, "none", "external", "internal"];
    const standings: (ClassStanding | null)[] = [null, "first-year", "sophomore", "junior", "senior"];
    let checked = 0;
    for (const term of terms.filter((t) => termOrdinal(t)! >= termOrdinal("SP24")!)) {
      for (const transfer of transfers) {
        for (const standing of standings) {
          const got = pick({ entryTerm: term, transfer, transferStanding: standing });
          const want = expectedVersion(term, transfer, standing);
          if (want === undefined) {
            expect(got.problem, `${term} ${transfer} ${standing}`).toMatch(/^needs-transfer/);
            expect(got.ids, `${term} ${transfer} ${standing}`).toEqual([]);
          } else if (transfer == null && want === "cals-college-2025") {
            // The curriculum is certain, but its CALS-credit rows (75 vs 55)
            // still depend on transfer status, so the app must ask. (Pre-2025
            // has one 55-credit row for everyone, so it never needs to.)
            expect(got.ids, `${term} ${transfer} ${standing}`).toEqual([want]);
            expect(got.problem, `${term} ${transfer} ${standing}`).toBe("needs-transfer");
          } else {
            expect(got.problem, `${term} ${transfer} ${standing}`).toBeUndefined();
            expect(got.ids, `${term} ${transfer} ${standing}`).toEqual([want]);
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(15 * 4 * 5);
  });
});

describe("selectLayers — several concentrations", () => {
  const major = layer({ id: "cals-major", kind: "major", programId: "test-major" });
  const c1 = layer({ id: "cals-major--c1", kind: "concentration", programId: "test-major", concentrationId: "c1" });
  const c2 = layer({ id: "cals-major--c2", kind: "concentration", programId: "test-major", concentrationId: "c2" });
  const all = [c2, c1, major, cals2025];
  const q = (over: Partial<StudentContext>) => ({
    family: "cals" as const,
    ...ctx({ entryTerm: "FA26", transfer: "none", ...over }),
  });
  const ids = (over: Partial<StudentContext>) => selectLayers(all, q(over)).layers.map((l) => l.id);

  it("zero concentrations: college and major only", () => {
    expect(ids({ concentrationIds: [] })).toEqual(["cals-college-2025", "cals-major"]);
  });

  it("one concentration", () => {
    expect(ids({ concentrationIds: ["c2"] })).toEqual(["cals-college-2025", "cals-major", "cals-major--c2"]);
  });

  it("two concentrations come back in the order given, not layer order", () => {
    expect(ids({ concentrationIds: ["c2", "c1"] })).toEqual([
      "cals-college-2025",
      "cals-major",
      "cals-major--c2",
      "cals-major--c1",
    ]);
  });

  it("an id with no layer is ignored; a repeated id counts once", () => {
    expect(ids({ concentrationIds: ["nope", "c1", "c1"] })).toEqual([
      "cals-college-2025",
      "cals-major",
      "cals-major--c1",
    ]);
  });

  it("another program's concentration is never picked", () => {
    const other = layer({ id: "x--c1", kind: "concentration", programId: "other", concentrationId: "c1" });
    const r = selectLayers([other, major, cals2025], q({ concentrationIds: ["c1"] }));
    expect(r.layers.map((l) => l.id)).toEqual(["cals-college-2025", "cals-major"]);
  });

  it("the legacy single concentrationId still works, and concentrationIds wins over it", () => {
    expect(ids({ concentrationId: "c1" })).toEqual(["cals-college-2025", "cals-major", "cals-major--c1"]);
    expect(ids({ concentrationId: "c1", concentrationIds: ["c2"] })).toEqual([
      "cals-college-2025",
      "cals-major",
      "cals-major--c2",
    ]);
    expect(ids({ concentrationId: "c1", concentrationIds: [] })).toEqual(["cals-college-2025", "cals-major"]);
  });
});
