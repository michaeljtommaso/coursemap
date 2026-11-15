/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { LoadedProgram } from "@/hooks/useAdditionalProgramData";
import type { Layer, LayerSharing } from "./distribution";
import { countsForKey } from "./questions/keys";
import { computeDistributionProgress, type DistributionProgressInput, type OverlapStats } from "./distributionProgress";

// Spec 047: a plan with a second major and minors on the Distribution engine.
// Every program id below is fictional.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "distribution", "fixtures");
const CAS = LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, "cas-college.json"), "utf8"))) as Layer;
const SRC = { url: "https://example.edu/program", anchor: "Requirements" };

const ECON: Layer = {
  id: "test-cas-econ",
  kind: "major",
  family: "cas",
  name: "Test Economics",
  catalogYear: "2026-27",
  programId: "test-cas-econ",
  rows: [
    { id: "intro", kind: "seat", label: "Intro micro", group: "Core", source: SRC, rule: { course: ["ECON-1110"] } },
    {
      id: "electives",
      kind: "pool",
      label: "Two upper-level econ courses",
      group: "Electives",
      source: SRC,
      rule: { allOf: [{ subject: ["ECON"] }, { number: { min: 3000 } }] },
      requiredCourses: 2,
      requiredCredits: 6,
    },
  ],
};

function mathLayer(sharing?: LayerSharing): Layer {
  return {
    id: "test-cas-math",
    kind: "major",
    family: "cas",
    name: "Test Mathematics",
    catalogYear: "2026-27",
    programId: "test-cas-math",
    ...(sharing ? { sharing } : {}),
    rows: [
      { id: "linear", kind: "seat", label: "Linear algebra", group: "Core", source: SRC, rule: { course: ["MATH-2210"] } },
      {
        id: "upper",
        kind: "pool",
        label: "One upper-level math or econometrics course",
        group: "Electives",
        source: SRC,
        rule: { anyOf: [{ subject: ["MATH"] }, { course: ["ECON-3120"] }] },
        requiredCourses: 1,
        requiredCredits: 3,
      },
    ],
  };
}

function minorLayer(sharing?: LayerSharing, extraRows: Layer["rows"] = []): Layer {
  return {
    id: "test-minor-data-science",
    kind: "minor",
    family: "other",
    name: "Test data minor",
    catalogYear: "2026-27",
    programId: "test-minor-data-science",
    ...(sharing ? { sharing } : {}),
    rows: [
      { id: "stats", kind: "seat", label: "Intro statistics", group: "Core", source: SRC, rule: { course: ["STAT-2000"] } },
      {
        id: "programming",
        kind: "seat",
        label: "Intro programming",
        group: "Core",
        source: SRC,
        rule: { course: ["CS-1110", "CS-1112"] },
      },
      { id: "ml", kind: "seat", label: "Machine learning", group: "Core", source: SRC, rule: { course: ["CS-3780"] } },
      {
        id: "applied",
        kind: "pool",
        label: "One applied data course",
        group: "Electives",
        source: SRC,
        rule: { course: ["ECON-3120", "ECON-3140", "STAT-3100"] },
        requiredCourses: 1,
        requiredCredits: 3,
      },
      ...extraRows,
    ],
  };
}

function loaded(kind: "major" | "minor", layer: Layer, over: Partial<LoadedProgram> = {}): LoadedProgram {
  return {
    programId: layer.programId!,
    kind,
    name: layer.name,
    shortName: kind === "minor" ? "Data minor" : "Math",
    layers: [layer],
    ...(layer.sharing ? { sharing: layer.sharing } : {}),
    status: "ok",
    ...over,
  };
}

function course(id: string, credits = 3): Course {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number}`,
    credits_min: credits,
    credits_max: credits,
    attrs: [],
  } as unknown as Course;
}

function board(ids: string[]): Pick<DistributionProgressInput, "placements" | "placedCourses"> {
  const placements: Placement[] = ids.map((id, i) => ({ id: `p-${id}`, courseId: id, sem: 1 + Math.floor(i / 5), order: i % 5 }));
  return { placements, placedCourses: Object.fromEntries(ids.map((id) => [id, course(id)])) };
}

function input(over: Partial<DistributionProgressInput> = {}): DistributionProgressInput {
  return {
    layers: [CAS, ECON],
    layerErrors: [],
    programId: "test-cas-econ",
    family: "cas",
    programStatus: "visible",
    ctx: { entryTerm: "FA26", transfer: "none", transferStanding: null },
    placements: [],
    placedCourses: {},
    creditProfile: [],
    waivedRequirementIds: [],
    primaryName: { name: "Test Economics, B.A.", shortName: "Economics" },
    ...over,
  };
}

const BOARD = ["ECON-1110", "ECON-3120", "ECON-3140", "MATH-2210", "STAT-2000"];

describe("spec 047 — sections and the primary's headline", () => {
  it("a plan with no extra programs gets none of the new fields", () => {
    const p = computeDistributionProgress(input(board(BOARD)));
    expect(p.sections).toBeUndefined();
    expect(p.attributionDetail).toBeUndefined();
    expect(p.groups.every((g) => g.sectionId === undefined)).toBe(true);
  });

  it("extra programs leave the top-level figures meaning the primary degree", () => {
    const alone = computeDistributionProgress(input(board(BOARD)));
    const both = computeDistributionProgress(
      input({ ...board(BOARD), extraPrograms: [loaded("major", mathLayer()), loaded("minor", minorLayer())] })
    );
    expect(both.pct).toBe(alone.pct);
    expect(both.satisfiedCount).toBe(alone.satisfiedCount);
    expect(both.total).toBe(alone.total);
    // The labels primary first, then the extras.
    expect(both.attribution["p-ECON-3120"].slice(0, alone.attribution["p-ECON-3120"].length)).toEqual(
      alone.attribution["p-ECON-3120"]
    );
  });

  it("sections: college, primary, then each extra in plan order with its color and status", () => {
    const p = computeDistributionProgress(
      input({
        ...board(BOARD),
        extraPrograms: [
          loaded("major", mathLayer()),
          loaded("minor", minorLayer()),
          { programId: "test-minor-loading", kind: "minor", name: "Loading minor", shortName: "L minor", layers: [], status: "loading" },
          { programId: "test-minor-broken", kind: "minor", name: "Broken minor", shortName: "B minor", layers: [], status: "unavailable" },
        ],
      })
    );
    expect(p.notice).toBeUndefined();
    expect(p.sections!.map((s) => [s.id, s.kind, s.color, s.status])).toEqual([
      [CAS.id, "college", null, "ok"],
      ["test-cas-econ", "primary", null, "ok"],
      ["test-cas-math", "secondMajor", 1, "ok"],
      ["test-minor-data-science", "minor", 2, "ok"],
      ["test-minor-loading", "minor", 3, "loading"],
      ["test-minor-broken", "minor", 4, "unavailable"],
    ]);
    const primary = p.sections![1];
    expect(primary.name).toBe("Test Economics, B.A.");
    expect(primary.shortName).toBe("Economics");
    const math = p.sections![2];
    expect([math.satisfiedCount, math.total, math.pct]).toEqual([2, 2, 100]);
    const minor = p.sections![3];
    expect(minor.shortName).toBe("Data minor");
    expect(minor.total).toBe(4);
    // Every group names its section; the sections' counts add up from them.
    expect(p.groups.every((g) => g.sectionId != null)).toBe(true);
    for (const s of p.sections!.filter((x) => x.status === "ok")) {
      const gs = p.groups.filter((g) => g.sectionId === s.id);
      expect(s.total).toBe(gs.reduce((n, g) => n + g.total, 0));
    }
    // Fill candidates exist for every loaded extra, in the same result.
    expect(Object.keys(p.fillCandidates!)).toEqual(["test-cas-math", "test-minor-data-science"]);
  });

  it("attributionDetail names each label's section", () => {
    const p = computeDistributionProgress(
      input({ ...board(BOARD), extraPrograms: [loaded("major", mathLayer()), loaded("minor", minorLayer())] })
    );
    const sections = p.attributionDetail!["p-ECON-3120"].map((d) => d.sectionId);
    expect(sections).toContain("test-cas-econ");
    expect(sections).toContain("test-cas-math");
    expect(sections).toContain("test-minor-data-science");
    expect(p.attributionDetail!["p-ECON-3120"].map((d) => d.label)).toEqual(p.attribution["p-ECON-3120"]);
  });

  it("the program rule leaf matches an additional program", () => {
    const gated: Layer = {
      ...ECON,
      rows: [
        ...ECON.rows,
        {
          id: "data-track",
          kind: "seat",
          label: "Data track course (data minors only)",
          group: "Core",
          source: SRC,
          rule: { allOf: [{ program: ["test-minor-data-science"] }, { course: ["STAT-2000"] }] },
        },
      ],
    };
    const row = (p: ReturnType<typeof computeDistributionProgress>) =>
      p.groups.flatMap((g) => g.items).find((i) => i.id === "test-cas-econ:data-track")!.status;
    expect(row(computeDistributionProgress(input({ ...board(BOARD), layers: [CAS, gated] })))).toBe("unmet");
    expect(
      row(
        computeDistributionProgress(
          input({ ...board(BOARD), layers: [CAS, gated], extraPrograms: [loaded("minor", minorLayer())] })
        )
      )
    ).toBe("satisfied");
  });
});

describe("spec 047 — overlap limits (D7/D8)", () => {
  it("'none' on the minor holds a shared course back and says so", () => {
    let stats: OverlapStats | null = null;
    const p = computeDistributionProgress(
      input({
        ...board(BOARD),
        extraPrograms: [loaded("minor", minorLayer({ otherMajors: "none" }))],
        onOverlapStats: (s) => (stats = s),
      })
    );
    const pair = p.overlap!.find((o) => o.b === "test-minor-data-science")!;
    expect(pair.a).toBe("test-cas-econ");
    expect(pair.limit).toBe("none");
    expect(pair.limitFrom).toBe("test-minor-data-science");
    expect(pair.sharedCourseIds).toEqual([]);
    expect(pair.estimated).toBe(false);
    // The search keeps the most total progress: ECON-3120 counts for the
    // minor (its applied row met) and econ's electives keep ECON-3140 alone
    // (partial) — 1.5 rows done against 1.0 the other way round.
    expect(pair.heldBack.map((h) => [h.courseId, h.heldFrom, h.countsFor])).toEqual([
      ["ECON-3120", "test-cas-econ", "test-minor-data-science"],
    ]);
    expect(p.heldBackByPlacement!["p-ECON-3120"]).toEqual([
      { courseId: "ECON-3120", placementId: "p-ECON-3120", countsFor: "test-minor-data-science", heldFrom: "test-cas-econ" },
    ]);
    const item = (id: string) => p.groups.flatMap((g) => g.items).find((i) => i.id === id)!;
    expect(item("test-minor-data-science:applied").status).toBe("satisfied");
    expect(item("test-cas-econ:electives").status).toBe("partial");
    expect(stats!.resolves).toBeGreaterThan(0);
    expect(stats!.unresolved).toBe(false);
  });

  it("a countsFor choice narrows the combinations: the course counts for the program chosen", () => {
    const minor = minorLayer({ otherMajors: "none" });
    const chosen = computeDistributionProgress(
      input({
        ...board(BOARD),
        extraPrograms: [loaded("minor", minor)],
        answers: { marks: { [countsForKey(ECON.id, "ECON-3120")]: "yes" }, facts: {} },
      })
    );
    const pair = chosen.overlap![0];
    expect(pair.sharedCourseIds).toEqual([]);
    // Never held back from econ now; the minor takes ECON-3140 instead.
    expect(pair.heldBack.some((h) => h.courseId === "ECON-3120" && h.heldFrom === "test-cas-econ")).toBe(false);
    expect(pair.heldBack.some((h) => h.courseId === "ECON-3120" && h.heldFrom === "test-minor-data-science")).toBe(true);
    expect(chosen.attributionDetail!["p-ECON-3120"].map((d) => d.sectionId)).not.toContain("test-minor-data-science");
    // The choice is listed in "Your answers" so it can be cleared.
    const answer = chosen.answers!.find((a) => a.key === countsForKey(ECON.id, "ECON-3120"))!;
    expect(answer.prompt).toBe("Count ECON 3120 for Economics");
    expect(answer.state).toBe("active");
  });

  it("a countsFor choice is inert while the pair is within its limit", () => {
    const minor = minorLayer({ otherMajors: { maxCourses: 3 } });
    const marks = { [countsForKey(ECON.id, "ECON-3120")]: "yes" as const };
    const p = computeDistributionProgress(
      input({ ...board(BOARD), extraPrograms: [loaded("minor", minor)], answers: { marks, facts: {} } })
    );
    expect(p.overlap![0].heldBack).toEqual([]);
    expect(p.overlap![0].sharedCourseIds).toEqual(["ECON-3120"]);
  });

  it("the stricter limit wins between two majors", () => {
    const p = computeDistributionProgress(
      input({
        ...board(BOARD),
        layers: [CAS, { ...ECON, sharing: { otherMajors: { maxCourses: 5 } } }],
        extraPrograms: [loaded("major", mathLayer({ otherMajors: { maxCourses: 0 } }))],
      })
    );
    const pair = p.overlap![0];
    expect(pair.limit).toEqual({ maxCourses: 0 });
    expect(pair.limitFrom).toBe("test-cas-math");
    expect(pair.sharedCourseIds).toEqual([]);
  });

  it("a forbidden pair is reported and the later program never reads as complete", () => {
    const p = computeDistributionProgress(
      input({
        ...board(BOARD),
        extraPrograms: [loaded("major", mathLayer({ forbiddenWith: ["test-cas-econ"] }))],
      })
    );
    expect(p.overlap![0].limit).toBe("forbidden");
    expect(p.overlap![0].limitFrom).toBe("test-cas-math");
    const math = p.sections!.find((s) => s.id === "test-cas-math")!;
    expect(math.pct).toBeLessThan(100);
    expect(math.satisfiedCount).toBeLessThan(math.total);
  });

  it("a chosen concentration's forbiddenWith forbids the pair too", () => {
    const conc: Layer = {
      id: "test-cas-math--physics-track",
      kind: "concentration",
      family: "cas",
      name: "Physics track",
      catalogYear: "2026-27",
      programId: "test-cas-math",
      concentrationId: "physics-track",
      sharing: { forbiddenWith: ["test-cas-econ"] },
      rows: [],
    };
    const p = computeDistributionProgress(
      input({ ...board(BOARD), extraPrograms: [loaded("major", mathLayer(), { layers: [mathLayer(), conc] })] })
    );
    expect(p.overlap![0].limit).toBe("forbidden");
  });

  it("a credits row of a minor counts toward overlap (C1)", () => {
    const credits = minorLayer({ otherMajors: "none" }, [
      { id: "total", kind: "credits", label: "Twelve credits", group: "Credits", source: SRC, rule: { subject: ["ECON", "STAT", "CS"] }, requiredCredits: 12 },
    ]);
    const p = computeDistributionProgress(input({ ...board(["ECON-1110"]), extraPrograms: [loaded("minor", credits)] }));
    // ECON-1110 fills econ's intro seat; the minor's credits row would count it.
    expect(p.overlap![0].heldBack.map((h) => h.courseId)).toEqual(["ECON-1110"]);
  });
});

describe("spec 047 — fill candidates (D3)", () => {
  it("unmet seat rows' courses, prerequisites first, minus placed courses and seats met by an equivalent", () => {
    const unlocks = (id: string) => (id === "CS-1110" ? ["CS-3780"] : id === "STAT-2000" ? ["CS-3780"] : []);
    const minor = minorLayer(undefined, [
      { id: "ml-first", kind: "seat", label: "ML (authored before its prerequisite)", group: "Core", source: SRC, rule: { course: ["CS-3780"] } },
    ]);
    // Authored order puts CS-3780 before CS-1110 in a second copy; the unlocks
    // order moves the prerequisite first.
    const reordered: Layer = { ...minor, rows: [minor.rows[2], minor.rows[0], minor.rows[1], ...minor.rows.slice(3)] };
    const p = computeDistributionProgress(
      input({ ...board(["ECON-1110"]), extraPrograms: [loaded("minor", reordered)], unlocks })
    );
    expect(p.fillCandidates!["test-minor-data-science"]).toEqual(["STAT-2000", "CS-1110", "CS-3780"]);

    // STAT-2000 placed; CS-1112 (an equivalent) fills the programming seat.
    const q = computeDistributionProgress(
      input({ ...board(["ECON-1110", "STAT-2000", "CS-1112"]), extraPrograms: [loaded("minor", reordered)], unlocks })
    );
    expect(q.fillCandidates!["test-minor-data-science"]).toEqual(["CS-3780"]);
  });

  it("a course held back by an overlap limit is never suggested (it is already placed)", () => {
    const minor = minorLayer({ otherMajors: "none" }, [
      { id: "micro", kind: "seat", label: "Intro micro", group: "Core", source: SRC, rule: { course: ["ECON-1110"] } },
    ]);
    const p = computeDistributionProgress(input({ ...board(["ECON-1110"]), extraPrograms: [loaded("minor", minor)] }));
    expect(p.fillCandidates!["test-minor-data-science"]).not.toContain("ECON-1110");
  });
});
