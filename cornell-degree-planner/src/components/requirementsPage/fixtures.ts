import type {
  DistributionItemInfo,
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  TriedProgress,
} from "@/hooks/useRequirementProgress";
import type { CatalogIndexRecord } from "@/lib/schemas";

/** Test fixtures for the Requirements page (fictional plan). */

export function item(
  id: string,
  over: Partial<RequirementItem> = {},
  dist?: Partial<DistributionItemInfo>
): RequirementItem {
  const [layerId, rowId] = id.split(":");
  return {
    id,
    label: id,
    category: null,
    suggestedSem: null,
    status: "unmet",
    coveredBy: [],
    checkable: true,
    requirement: null,
    ...(dist
      ? {
          dist: {
            layerId,
            rowId: rowId ?? id,
            layerKind: "college",
            rowKind: "seat",
            engineStatus: "unmet",
            countedCodes: [],
            ...dist,
          },
        }
      : {}),
    ...over,
  };
}

export const FWS = item(
  "cas-college:fws",
  { label: "First-Year Writing Seminars", status: "partial", coveredBy: ["p1"] },
  { rowKind: "pool", engineStatus: "partial", coursesHave: 1, coursesNeed: 2, countedCodes: ["HIST 1200"] }
);

export const DIST = item(
  "cas-college:dist",
  { label: "Cover the distribution categories", status: "partial", coveredBy: ["p2"] },
  {
    rowKind: "distribution",
    engineStatus: "partial",
    categoriesHave: 1,
    categoriesNeed: 3,
    countedCodes: ["ARTH 1100"],
    categories: [
      { id: "ALC", label: "Arts, Lit & Culture", filled: true, missing: false },
      { id: "HST", label: "Historical", filled: false, missing: true },
      { id: "ETM", label: "Ethics & Mind", filled: false, missing: true },
    ],
  }
);

export const ADVISE_COLLEGE = item(
  "cas-college:residency",
  { label: "Eight semesters in residence", checkable: false },
  { rowKind: "confirm", engineStatus: "confirm", confirm: true }
);

export const CORE = item(
  "econ:core3030",
  { label: "ECON 3030" },
  { layerKind: "major", rowKind: "seat", engineStatus: "unmet" }
);

export const ADVISE_MAJOR = item(
  "econ:advisor",
  { label: "Meet your major advisor", checkable: false },
  { layerKind: "major", rowKind: "confirm", engineStatus: "confirm", confirm: true }
);

/** Engineering liberal studies (spec 037 D9): six tagged courses in two
 *  groups, Race & Equity still required. Rendered like a distribution row. */
export const ENG_LS = item(
  "liberal-studies",
  { label: "Liberal Studies", status: "partial", coveredBy: ["p1", "p2", "p3", "p4"] },
  {
    layerId: "engineering",
    rowId: "liberal-studies",
    layerKind: "college",
    rowKind: "distribution",
    engineStatus: "partial",
    categoriesHave: 2,
    categoriesNeed: 3,
    coursesHave: 4,
    coursesNeed: 6,
    creditsHave: 13,
    creditsNeed: 18,
    countedCodes: ["ECON 1110", "ECON 1120", "GOVT 1111", "PHIL 1100"],
    categories: [
      { id: "g1", label: "Arts & Culture", filled: false, missing: false },
      { id: "g2", label: "History", filled: false, missing: false },
      { id: "g3", label: "Ethics & Mind", filled: true, missing: false },
      { id: "g4", label: "Social Science", filled: true, missing: false },
      { id: "g5", label: "Language", filled: false, missing: false },
      { id: "g6", label: "Communications", filled: false, missing: false },
      { id: "g7", label: "Race & Equity", filled: false, missing: true },
    ],
  }
);

/** An Engineering seat (no distribution info). */
export const ENG_CORE = item("ore-s3-orie3500", { label: "ORIE 3500", status: "satisfied", coveredBy: ["p5"] });

export const ENG_GROUPS: RequirementGroup[] = [
  group("core", "Core", [ENG_CORE]),
  group("liberal", "Liberal studies", [ENG_LS]),
];

function group(key: string, label: string, items: RequirementItem[]): RequirementGroup {
  const counted = items.filter((it) => !it.dist?.confirm);
  return {
    key,
    label,
    items,
    satisfiedCount: counted.filter((it) => it.status === "satisfied" || it.status === "waived").length,
    total: counted.length,
  };
}

export const GROUPS: RequirementGroup[] = [
  group("cas-college:Writing seminars", "College · Writing seminars", [FWS]),
  group("cas-college:Distribution", "College · Distribution", [DIST]),
  group("cas-college:Residency", "College · Residency", [ADVISE_COLLEGE]),
  group("econ:Core", "Major · Core", [CORE, ADVISE_MAJOR]),
];

/** DIST recomputed with HIST-1530 tried: Historical filled. */
export const DIST_TRIED: RequirementItem = {
  ...DIST,
  coveredBy: ["p2", "tried:HIST-1530"],
  dist: {
    ...DIST.dist!,
    categoriesHave: 2,
    countedCodes: ["ARTH 1100", "HIST 1530"],
    categories: DIST.dist!.categories!.map((c) => (c.id === "HST" ? { ...c, filled: true, missing: false } : c)),
  },
};

export const TRIED: TriedProgress = {
  courseIds: ["HIST-1530"],
  notOnBoard: ["HIST-1530"],
  items: { [FWS.id]: FWS, [DIST.id]: DIST_TRIED, [CORE.id]: CORE },
  fills: { "HIST-1530": [DIST.label] },
  missing: [],
};

export function progress(over: Partial<RequirementProgress> = {}): RequirementProgress {
  return {
    engine: "distribution",
    groups: GROUPS,
    attribution: {},
    satisfiedCount: 0,
    total: 4,
    catalogYear: "2026-27",
    collegeVersion: "Arts & Sciences",
    ...over,
  };
}

export function record(id: string, over: Partial<CatalogIndexRecord> = {}): CatalogIndexRecord {
  const [subject, number] = id.split("-");
  return {
    id,
    subject,
    number,
    title: `${subject} ${number} title`,
    creditsMin: 3,
    creditsMax: 3,
    hasPrereqs: false,
    offered: ["FA", "SP"],
    attrs: [],
    fws: false,
    unlocks: [],
    roster: null,
    lead: null,
    meets: [],
    ...over,
  } as CatalogIndexRecord;
}
