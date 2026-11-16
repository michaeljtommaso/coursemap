/**
 * The Try strip's search hint on a real Engineering program (ORE, Fall 2025
 * start, empty board): a liberal studies course is reported as filling a
 * liberal studies group, in the Liberal studies card and from any other card
 * (a tried class counts wherever it fits on the page), and a course the
 * advisor-approved seats exclude is never reported as filling them. Also the
 * liberal studies row's unknown-start-term note.
 */
import { describe, it, expect, vi } from "vitest";
// The hooks these modules export read app contexts; the pure builders tested
// here don't, so the contexts are stubbed (as in useCourseFilters.test.ts).
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => ({ aliases: {} }) }));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ planProgramId: null }) }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => ({ slots: [] }) }));
vi.mock("@/hooks/useAdditionalProgramData", () => ({ useAdditionalProgramData: () => ({ programs: [], allLoaded: true }) }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => ({ groups: [] }) }));
vi.mock("@/store/useProgramStore", () => ({ useProgramStore: () => null }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ studentContext: { entryTerm: null }, enteringYear: null }) }));
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramSchema, type CatalogIndexRecord } from "@/lib/schemas";
import { normalizeProgramSlots } from "@/lib/normalize/normalizeProgram";
import { computeRequirementProgress } from "@/lib/planner/requirementProgress";
import {
  buildLiberalStudiesPredicate,
  buildRequirementPredicate,
  liberalStudiesFilterCohort,
} from "@/hooks/useCourseFilters";
import { buildPageModel } from "./pageModel";
import { secondMajorSlots } from "@/lib/planner/engineeringDoubleMajor";
import { buildFillTargets } from "./useFillTargets";
import { elsewhereTargets, searchHint, searchHintText, type GroupTargets } from "./suggestions";

function seedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const legacy = JSON.parse(readFileSync(join(seedDir(), "programs.json"), "utf-8")) as { id: string }[];
const oreDoc = legacy.find((p) => p.id === "cornell-ore-bs-2026");
if (!oreDoc) throw new Error("cornell-ore-bs-2026 not in programs.json");
const ORE = normalizeProgramSlots(ProgramSchema.parse(oreDoc));

const record = (id: string, attrs: string[] = []): CatalogIndexRecord => {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: id,
    creditsMin: 3,
    creditsMax: 3,
    hasPrereqs: false,
    offered: ["FA"],
    attrs,
    fws: false,
    unlocks: [],
    roster: null,
    lead: null,
    meets: [],
  };
};

const ECON_1110 = record("ECON-1110", ["SBA-AG", "SSC-AS"]);
const MATH_1110 = record("MATH-1110");

/** Every card's targets for ORE with an empty board, as the page builds them. */
function oreCards(entryTerm: string | null): GroupTargets[] {
  const progress = computeRequirementProgress({
    templateSlots: ORE,
    placements: [],
    placedCourses: {},
    creditProfile: [],
    waivedRequirementIds: [],
    entryTerm,
  });
  const model = buildPageModel(progress.groups, {}, "engineering");
  const identity = (id: string) => id;
  const ctx = {
    layers: undefined,
    programId: "cornell-ore-bs-2026",
    canonical: identity,
    aliases: {},
    engineering: buildRequirementPredicate(ORE, identity),
    liberalStudies: buildLiberalStudiesPredicate(liberalStudiesFilterCohort(entryTerm, null)),
  };
  return model.sections.flatMap((s) =>
    s.groups.map((g) => ({ key: g.key, title: g.title, targets: buildFillTargets(g.items, ctx) }))
  );
}

describe("Try strip search hint — ORE, Fall 2025 start", () => {
  const cards = oreCards("FA25");
  const card = (key: string) => {
    const c = cards.find((g) => g.key === key);
    if (!c) throw new Error(`no card ${key}; have ${cards.map((g) => g.key).join(", ")}`);
    return c;
  };
  const hintIn = (key: string, r: CatalogIndexRecord) =>
    searchHint(r, card(key).targets, elsewhereTargets(cards, key));

  it("ECON 1110 fills Social Science in the Liberal studies card", () => {
    const h = hintIn("liberal", ECON_1110);
    expect(h.fills).toEqual(["Social Science"]);
    expect(searchHintText(h)).toBe("Fills Social Science");
  });

  it("ECON 1110 searched from a card it doesn't fill names Liberal studies, not 'fills nothing'", () => {
    const other = cards.find((g) => g.key !== "liberal" && g.key !== "elective");
    expect(other).toBeDefined();
    const h = hintIn(other!.key, ECON_1110);
    expect(h.fills).toEqual([]);
    expect(h.elsewhere).toContain("Social Science (Liberal studies)");
    const text = searchHintText(h);
    expect(text).toMatch(/^Nothing open here\. Fills .*Social Science \(Liberal studies\)/);
    expect(text).not.toMatch(/Doesn't fill/);
  });

  it("MATH 1110 is never reported as filling the advisor-approved seat", () => {
    for (const c of cards) {
      const h = hintIn(c.key, MATH_1110);
      for (const label of [...h.fills, ...h.elsewhere]) expect(label).not.toMatch(/Advisor-Approved/);
    }
    // The seat itself is a target, and an 1100+ course fills it.
    expect(card("elective").targets.map((t) => t.label)).toContain("Advisor-Approved Elective");
    expect(hintIn("elective", record("CS-2110")).fills).toContain("Advisor-Approved Elective");
  });

  it("a course nothing on the page takes still says it fills nothing", () => {
    const h = hintIn("liberal", record("ZZZ-0100"));
    expect(h).toEqual({ fills: [], elsewhere: [] });
    expect(searchHintText(h)).toBe("Doesn't fill anything still open");
  });
});

describe("liberal studies row — unknown start term", () => {
  it("asks for the start term to check Race & Equity, without naming Group 7", () => {
    const progress = computeRequirementProgress({
      templateSlots: ORE,
      placements: [],
      placedCourses: {},
      creditProfile: [],
      waivedRequirementIds: [],
      entryTerm: null,
      enteringYear: null,
    });
    const ls = progress.groups.flatMap((g) => g.items).find((it) => it.id === "liberal-studies");
    expect(ls?.dist?.note).toBe(
      "Your college's requirements depend on when you started at Cornell. Add your start term to check Race & Equity."
    );
    expect(ls?.dist?.note).not.toMatch(/Group 7/);
  });
});

describe("an Engineering second major's rows (spec 047 D15): ME + ORE", () => {
  const meDoc = legacy.find((p) => p.id === "cornell-me-bs-2026");
  if (!meDoc) throw new Error("cornell-me-bs-2026 not in programs.json");
  const ME = normalizeProgramSlots(ProgramSchema.parse(meDoc));
  const identity = (id: string) => id;
  const progress = computeRequirementProgress({
    templateSlots: ME,
    placements: [],
    placedCourses: {},
    creditProfile: [],
    waivedRequirementIds: [],
    entryTerm: "FA25",
    programId: "cornell-me-bs-2026",
    primaryName: { name: "Mechanical Engineering, B.S.", shortName: "ME" },
    extraPrograms: [
      {
        programId: "cornell-ore-bs-2026",
        kind: "major",
        name: "Operations Research and Engineering, B.S.",
        shortName: "ORE",
        layers: [],
        template: ORE,
        status: "ok",
      },
    ],
  });
  const oreItems = progress.groups.filter((g) => g.sectionId === "cornell-ore-bs-2026").flatMap((g) => g.items);
  const elective = oreItems.find((it) => it.label.includes("ORIE Elective"));
  const ctx = (engineering: (r: CatalogIndexRecord, id: string) => boolean) => ({
    layers: undefined,
    programId: "cornell-me-bs-2026",
    canonical: identity,
    aliases: {},
    engineering,
    liberalStudies: buildLiberalStudiesPredicate(liberalStudiesFilterCohort("FA25", null)),
  });
  const BIOMI = record("BIOMI-1100");
  const ORIE = record("ORIE-4350"); // on the ORIE Elective list (ORIE 4580 is a required course)

  it("the ORIE Elective row is ORE's, not one of ME's", () => {
    expect(elective, `ORE rows: ${oreItems.map((it) => it.label).join(", ")}`).toBeDefined();
  });

  it("read with ORE's own rules, it suggests ORIE 4350 and never BIOMI 1100", () => {
    const own = buildRequirementPredicate(secondMajorSlots(ME, ORE, identity), identity, false);
    const [t] = buildFillTargets([elective!], ctx(own));
    expect(t.test(ORIE)).toBe(true);
    expect(t.test(BIOMI)).toBe(false);
  });

  it("read with ME's rules it suggests nothing (an unknown row used to match every class)", () => {
    const [before] = buildFillTargets([elective!], ctx(buildRequirementPredicate(ME, identity)));
    expect(before.test(BIOMI)).toBe(true); // the bug: BIOMI 1100 "fills ORIE Elective"
    const [after] = buildFillTargets([elective!], ctx(buildRequirementPredicate(ME, identity, false)));
    expect(after.test(BIOMI)).toBe(false);
    expect(after.test(ORIE)).toBe(false);
  });
});
