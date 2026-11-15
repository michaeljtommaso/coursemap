import { describe, expect, it } from "vitest";
import type { MinorIndexEntry } from "@/lib/schemas";
import type { OverlapPair, ProgramSection } from "@/hooks/useRequirementProgress";
import type { Program } from "@/types/db";
import {
  addButtons,
  extraEntries,
  fillToast,
  majorGroups,
  matchesProgramPrefix,
  minorGroups,
  overlapLine,
  primaryEntry,
  segmentValue,
  type PickerContext,
} from "./programsModel";

const prog = (id: string, name: string, short: string, collegeId: Program["collegeId"], status?: "hidden"): Program => ({
  id,
  name,
  short_name: short,
  college: "",
  catalog_year: 2026,
  total_credits: null,
  affiliation_text: null,
  created_at: "",
  collegeId,
  family: collegeId === "engineering" ? "engineering" : (collegeId ?? "engineering"),
  ...(status ? { status } : {}),
});

const ECON = prog("cornell-econ-ba", "Economics, B.A.", "Economics", "cas");
const MATH = prog("cornell-math-ba", "Mathematics, B.A.", "Mathematics", "cas");
const GOVT = prog("cornell-govt-ba", "Government, B.A.", "Government", "cas");
const HIDDEN = prog("cornell-old-ba", "Old Major, B.A.", "Old", "cas", "hidden");
const AEM = prog("cornell-aem-bs", "Applied Economics and Management, B.S.", "AEM", "cals");
const CS = prog("cornell-cs-bs", "Computer Science, B.S.", "CS", "engineering");

const minor = (id: string, name: string, offeredBy: string, extra: Partial<MinorIndexEntry> = {}): MinorIndexEntry => ({
  id,
  name,
  shortName: `${name} minor`,
  offeredBy,
  catalogYear: "2026-27",
  ...extra,
});

const section = (s: Partial<ProgramSection> & Pick<ProgramSection, "id" | "kind">): ProgramSection => ({
  name: s.id,
  shortName: s.id,
  color: null,
  pct: 0,
  satisfiedCount: 0,
  total: 0,
  status: "ok",
  ...s,
});

function ctx(over: Partial<PickerContext> = {}): PickerContext {
  return {
    primaryId: ECON.id,
    primaryProgram: ECON,
    list: [],
    shortNameOf: (id) => ({ [ECON.id]: "Economics", [MATH.id]: "Mathematics", [CS.id]: "CS" })[id] ?? id,
    sharingOf: () => undefined,
    ...over,
  };
}

describe("matchesProgramPrefix", () => {
  it("matches an id itself and its catalog-year forms, like the program rule leaf", () => {
    expect(matchesProgramPrefix("cornell-cs-bs", ["cornell-cs-bs"])).toBe(true);
    expect(matchesProgramPrefix("cornell-cs-bs-2026", ["cornell-cs-bs"])).toBe(true);
    expect(matchesProgramPrefix("cornell-cs-bsx", ["cornell-cs-bs"])).toBe(false);
    expect(matchesProgramPrefix(null, ["cornell-cs-bs"])).toBe(false);
    expect(matchesProgramPrefix("cornell-cs-bs", undefined)).toBe(false);
  });
});

describe("stack entries", () => {
  it("the primary reads its section, else the top-level numbers (D14)", () => {
    const fromTop = primaryEntry(ECON.id, ECON, { satisfiedCount: 8, total: 13, pct: 61.5 });
    expect(fromTop).toMatchObject({ kind: "primary", shortName: "Economics", pct: 62, done: 8, total: 13, status: "ok" });
    expect(segmentValue(fromTop)).toBe("62%");
    const fromSection = primaryEntry(ECON.id, ECON, {
      satisfiedCount: 1,
      total: 2,
      sections: [section({ id: ECON.id, kind: "primary", pct: 40, satisfiedCount: 4, total: 10 })],
    });
    expect(fromSection).toMatchObject({ pct: 40, done: 4, total: 10 });
    // Engineering: no pct, a ratio.
    expect(primaryEntry(CS.id, CS, { satisfiedCount: 3, total: 12 }).pct).toBe(25);
    // Nothing solved yet: no figure.
    expect(segmentValue(primaryEntry(CS.id, CS, { satisfiedCount: 0, total: 0 }))).toBe("");
  });

  it("extras take their section's numbers and color, loading until it arrives; minors show n/m", () => {
    const list = [
      { programId: MATH.id, kind: "major" as const },
      { programId: "cs-minor", kind: "minor" as const },
    ];
    const names = (id: string) => (id === MATH.id ? { name: MATH.name, shortName: "Mathematics" } : null);
    const [m, c] = extraEntries(
      list,
      [section({ id: "cs-minor", kind: "minor", shortName: "CS minor", color: 2, satisfiedCount: 3, total: 6, pct: 50 })],
      names
    );
    expect(m).toMatchObject({ kind: "secondMajor", shortName: "Mathematics", color: 1, status: "loading" });
    expect(segmentValue(m)).toBe("");
    expect(c).toMatchObject({ kind: "minor", shortName: "CS minor", color: 2, status: "ok" });
    expect(segmentValue(c)).toBe("3/6");
    const failed = extraEntries(list.slice(0, 1), [section({ id: MATH.id, kind: "secondMajor", status: "unavailable" })], names);
    expect(segmentValue(failed[0])).toBe("can't load");
  });
});

describe("add buttons", () => {
  it("a second major: one per plan, A&S/CALS only, refused by a layer that forbids it", () => {
    expect(addButtons({ list: [], primaryProgram: ECON, primarySharing: undefined }).major).toEqual({
      enabled: true,
      label: "Add a second major",
    });
    expect(
      addButtons({ list: [{ programId: MATH.id, kind: "major" }], primaryProgram: ECON, primarySharing: undefined }).major
    ).toEqual({ enabled: false, label: "Second major (one per plan)" });
    expect(addButtons({ list: [], primaryProgram: CS, primarySharing: undefined }).major.enabled).toBe(false);
    expect(
      addButtons({ list: [], primaryProgram: ECON, primarySharing: { otherMajors: "forbidden" } }).major.label
    ).toBe("Second major (Economics doesn't allow one)");
  });

  it("a minor: off at three", () => {
    const three = ["a", "b", "c"].map((id) => ({ programId: id, kind: "minor" as const }));
    expect(addButtons({ list: three.slice(0, 2), primaryProgram: ECON, primarySharing: undefined }).minor.enabled).toBe(true);
    expect(addButtons({ list: three, primaryProgram: ECON, primarySharing: undefined }).minor).toEqual({
      enabled: false,
      label: "Minor (three per plan)",
    });
  });
});

describe("the add picker", () => {
  it("second majors: the primary's college's visible majors, the plan's own disabled", () => {
    const groups = majorGroups([ECON, MATH, GOVT, HIDDEN, AEM, CS], ctx({ list: [{ programId: MATH.id, kind: "major" }] }), "");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Arts & Sciences");
    expect(groups[0].rows.map((r) => [r.id, r.disabledReason])).toEqual([
      [ECON.id, "on this plan"],
      [GOVT.id, null],
      [MATH.id, "on this plan"],
    ]);
    expect(majorGroups([ECON, MATH], ctx({ primaryId: CS.id, primaryProgram: CS }), "")).toEqual([]);
  });

  it("second majors: a layer in memory that forbids a second major or names the pair is disabled (D14)", () => {
    const sharingOf = (id: string) =>
      id === GOVT.id ? { otherMajors: "forbidden" as const } : id === MATH.id ? { forbiddenWith: ["cornell-econ-ba"] } : undefined;
    const rows = majorGroups([ECON, MATH, GOVT], ctx({ sharingOf }), "")[0].rows;
    expect(rows.find((r) => r.id === GOVT.id)?.disabledReason).toBe("doesn't allow a second major");
    expect(rows.find((r) => r.id === MATH.id)?.disabledReason).toBe("can't be combined with Economics");
  });

  it("search narrows by name or short name", () => {
    expect(majorGroups([ECON, MATH, GOVT], ctx(), "math")[0].rows.map((r) => r.id)).toEqual([MATH.id]);
    expect(majorGroups([ECON, MATH, GOVT], ctx(), "zzz")).toEqual([]);
  });

  it("minors: grouped by who offers them, hidden left out, notOpenTo and on-plan disabled (D12)", () => {
    const entries = [
      minor("cs-minor", "Computer Science", "Bowers CIS", { notOpenTo: ["cornell-cs-bs"] }),
      minor("math-minor", "Mathematics", "Arts & Sciences"),
      minor("econ-minor", "Economics", "Arts & Sciences", { notOpenTo: ["cornell-econ-ba"] }),
      minor("gone-minor", "Gone", "Arts & Sciences", { visible: false }),
    ];
    const groups = minorGroups(
      entries,
      ctx({ list: [{ programId: "math-minor", kind: "minor" }, { programId: CS.id, kind: "major" }] }),
      ""
    );
    expect(groups.map((g) => g.label)).toEqual(["Arts & Sciences", "Bowers CIS"]);
    expect(groups[0].rows.map((r) => [r.id, r.disabledReason])).toEqual([
      ["econ-minor", "Not open to Economics majors"],
      ["math-minor", "on this plan"],
    ]);
    // The second major counts too.
    expect(groups[1].rows[0].disabledReason).toBe("Not open to CS majors");
  });
});

describe("toasts (D3, D9)", () => {
  it("says what went to Tried", () => {
    expect(fillToast("CS minor", 6, 6, 20)).toBe("Added 6 required classes for CS minor to Tried.");
    expect(fillToast("CS minor", 1, 1, 20)).toBe("Added 1 required class for CS minor to Tried.");
    expect(fillToast("CS minor", 0, 0, 20)).toBe("Your board already covers CS minor's required classes.");
    expect(fillToast("Mathematics", 18, 12, 20)).toBe(
      "Added 12 of 18 required classes for Mathematics. Tried holds 20 — place some on the board to make room."
    );
    expect(fillToast("Mathematics", 4, 0, 20)).toMatch(/^Tried is full \(it holds 20\)/);
  });

});

describe("the overlap line (D8)", () => {
  const names = (id: string) => ({ econ: "Economics", math: "Mathematics" })[id] ?? id;
  const pair = (over: Partial<OverlapPair>): OverlapPair => ({
    a: "econ",
    b: "math",
    limit: { maxCourses: 2 },
    sharedCourseIds: ["ECON-3130", "MATH-2210"],
    heldBack: [],
    estimated: false,
    ...over,
  });

  it("names the count and each held-back course", () => {
    expect(
      overlapLine(
        pair({ heldBack: [{ courseId: "ECON-3110", placementId: "p1", countsFor: "econ", heldFrom: "math" }] }),
        names
      )
    ).toBe("2 of 2 shared courses used · ECON 3110 counts for Economics only, because of the Mathematics limit.");
  });

  it("covers none, credits, forbidden and the estimated note", () => {
    expect(overlapLine(pair({ limit: "none", sharedCourseIds: [] }), names)).toBe("No shared courses allowed.");
    expect(overlapLine(pair({ limit: { maxCredits: 12 }, sharedCourseIds: ["A-1"] }), names)).toBe(
      "1 shared course · up to 12 shared credits."
    );
    expect(overlapLine(pair({ limit: "forbidden" }), names)).toBe(
      "Economics and Mathematics can't be combined. Check with your advisor."
    );
    expect(overlapLine(pair({ estimated: true }), names)).toBe(
      "2 of 2 shared courses used. Estimated: progress may be understated."
    );
  });
});
