import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_PROGRAM_IDS,
  LEGACY_WAIVER_MAPS,
  canonicalAdditionalPrograms,
  canonicalProgramId,
  isLegacyProgramId,
  migrateLegacyWaivers,
} from "./legacyPrograms";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYERS = resolve(HERE, "../../../../scripts/seed-data/layers/cals");

function layerRowIds(layerId: string): Set<string> {
  const layer = JSON.parse(readFileSync(resolve(LAYERS, `${layerId}.json`), "utf8")) as {
    id: string;
    rows: { id: string }[];
  };
  expect(layer.id).toBe(layerId);
  return new Set(layer.rows.map((r) => r.id));
}

// Every requirement id the old engine could waive (seat slots + elective
// groups), frozen from the retired programs-2025 files.
const OLD_REQUIREMENT_IDS: Record<string, string[]> = {
  "cornell-infosci-bs-2025": [
    "infosci-s1-info1300", "infosci-s1-cs111x", "infosci-s1-fwis", "infosci-s1-pe",
    "infosci-s2-info2450", "infosci-s2-fwis", "infosci-s2-pe", "infosci-s3-info2850",
    "infosci-s3-info2950", "liberal-studies", "advisor-elective-open", "free-elective",
    "infosci-core-1200-1260", "infosci-math-calc", "infosci-stats", "infosci-concentration",
    "infosci-elective",
  ],
  "cornell-comm-bs-2025": [
    "comm-s1-comm1111", "comm-s1-comm1101", "comm-s1-fwis", "comm-s1-pe", "comm-s2-comm1300",
    "comm-s2-comm2310", "comm-s2-pe", "comm-s3-comm2010", "comm-s4-comm2820",
    "liberal-studies", "advisor-elective-open", "free-elective", "comm-stats",
    "comm-core-choice", "comm-upper", "comm-practicum",
  ],
};

describe("legacy program ids", () => {
  it("maps the two old ids and leaves everything else alone", () => {
    expect(canonicalProgramId("cornell-infosci-bs-2025")).toBe("cornell-information-science-bs-2026");
    expect(canonicalProgramId("cornell-comm-bs-2025")).toBe("cornell-communication-bs-2026");
    expect(canonicalProgramId("cornell-cs-bs-2025")).toBe("cornell-cs-bs-2025");
    expect(canonicalProgramId("cornell-information-science-bs-2026")).toBe("cornell-information-science-bs-2026");
    expect(canonicalProgramId("toString")).toBe("toString");
    expect(isLegacyProgramId("cornell-comm-bs-2025")).toBe(true);
    expect(isLegacyProgramId("constructor")).toBe(false);
  });

  it("names every old requirement id exactly once", () => {
    for (const [oldId, ids] of Object.entries(OLD_REQUIREMENT_IDS)) {
      expect(Object.keys(LEGACY_WAIVER_MAPS[oldId]).sort()).toEqual([...ids].sort());
    }
  });

  it("points every mapped waiver at a row in the program's released layer", () => {
    for (const [oldId, map] of Object.entries(LEGACY_WAIVER_MAPS)) {
      const layerId = LEGACY_PROGRAM_IDS[oldId];
      const rows = layerRowIds(layerId);
      for (const target of Object.values(map)) {
        if (target === null) continue;
        const [layer, row] = target.split(":");
        expect(layer).toBe(layerId);
        expect(rows.has(row), `${target} is not a row of ${layerId}`).toBe(true);
      }
    }
  });

  it("maps no two old requirements onto one row", () => {
    for (const map of Object.values(LEGACY_WAIVER_MAPS)) {
      const targets = Object.values(map).filter((t): t is string => t !== null);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe("migrateLegacyWaivers", () => {
  const INFO = "cornell-information-science-bs-2026";

  it("translates mapped ids and drops partial and unknown ones", () => {
    expect(
      migrateLegacyWaivers("cornell-infosci-bs-2025", [
        "infosci-s1-info1300",
        "infosci-s1-fwis",
        "liberal-studies",
        "infosci-s3-free", // an elective slot id: never a requirement id
        "infosci-elective",
      ])
    ).toEqual([`${INFO}:core-web`, `${INFO}:electives`]);
  });

  it("keeps layer-format ids, so a second pass changes nothing", () => {
    const once = migrateLegacyWaivers("cornell-comm-bs-2025", [
      "comm-core-choice",
      "cals-college-2025:pe",
      "comm-s1-pe",
    ]);
    expect(once).toEqual(["cornell-communication-bs-2026:core-three", "cals-college-2025:pe"]);
    expect(migrateLegacyWaivers("cornell-comm-bs-2025", once)).toEqual(once);
  });

  it("dedupes when an old and an already-translated id meet", () => {
    expect(
      migrateLegacyWaivers("cornell-infosci-bs-2025", ["infosci-stats", `${INFO}:statistics`])
    ).toEqual([`${INFO}:statistics`]);
  });

  it("leaves waivers on any other program untouched", () => {
    const ids = ["cs-s1-cs1110", "liberal-studies", "weird"];
    expect(migrateLegacyWaivers("cornell-cs-bs-2025", ids)).toBe(ids);
    expect(migrateLegacyWaivers(INFO, ids)).toBe(ids);
  });
});

describe("canonicalAdditionalPrograms (spec 047 D13)", () => {
  it("reads retired ids as current, dropping a repeat and the primary (first wins)", () => {
    const list = [
      { programId: "cornell-infosci-bs-2025", kind: "major" as const },
      { programId: "cornell-information-science-bs-2026", kind: "major" as const },
      { programId: "cas-x", kind: "minor" as const },
    ];
    expect(canonicalAdditionalPrograms(list, "cas-econ-ba")).toEqual([
      { programId: "cornell-information-science-bs-2026", kind: "major" },
      { programId: "cas-x", kind: "minor" },
    ]);
    expect(canonicalAdditionalPrograms(list, "cornell-information-science-bs-2026")).toEqual([{ programId: "cas-x", kind: "minor" }]);
  });

  it("returns the same array when nothing changes", () => {
    const list = [{ programId: "cas-x", kind: "minor" as const }];
    expect(canonicalAdditionalPrograms(list, "cas-econ-ba")).toBe(list);
  });
});
