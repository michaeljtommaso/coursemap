/**
 * legacyPrograms.ts (spec 019 D12) — Information Science and Communication
 * moved from Engineering-format program files (`cornell-infosci-bs-2025`,
 * `cornell-comm-bs-2025`) to CALS layers with new program ids. Saved plans,
 * share links and guest plans still carry the old ids, so every read of a
 * stored program id goes through `canonicalProgramId`, and a plan read under
 * an old id has its waivers translated by `migrateLegacyWaivers`.
 *
 * Translation happens on read (no live migration script) and is idempotent.
 * A plan's translated waivers are written with its next save, but plan writes
 * never rewrite `programId`: old docs keep the old id, so this map is
 * permanent. Share links keep their frozen waivers (they only count them).
 *
 * Waiver maps cover every requirement id the old engine could waive (seat
 * slot ids and elective group ids, `programToRequirements`). An old
 * requirement maps to a layer row only when waiving the row waives exactly
 * what the old waiver did; otherwise it maps to null and is dropped. A layer
 * waiver removes its whole row (`engine.ts`), so carrying a partial waiver
 * across would turn a requirement green that the student never waived.
 */
import { translateWaivers, type WaiverMap } from "./waiverTranslation";

const INFOSCI = "cornell-information-science-bs-2026";
const COMM = "cornell-communication-bs-2026";

/** Old program id → current program id. */
export const LEGACY_PROGRAM_IDS: Readonly<Record<string, string>> = {
  "cornell-infosci-bs-2025": INFOSCI,
  "cornell-comm-bs-2025": COMM,
};

/** Old program id → its waiver map (old requirement id → `${layerId}:${rowId}` or null). */
export const LEGACY_WAIVER_MAPS: Readonly<Record<string, WaiverMap>> = {
  "cornell-infosci-bs-2025": {
    "infosci-s1-info1300": `${INFOSCI}:core-web`,
    "infosci-s1-cs111x": `${INFOSCI}:programming`,
    "infosci-s2-info2450": `${INFOSCI}:core-communication`,
    "infosci-s3-info2850": `${INFOSCI}:core-networks`,
    "infosci-s3-info2950": `${INFOSCI}:core-data-science`,
    "infosci-core-1200-1260": `${INFOSCI}:core-ethics`,
    "infosci-math-calc": `${INFOSCI}:calculus`,
    "infosci-stats": `${INFOSCI}:statistics`,
    "infosci-elective": `${INFOSCI}:electives`,
    // One of two writing-seminar / PE seats; the CALS college rows need both.
    "infosci-s1-fwis": null,
    "infosci-s2-fwis": null,
    "infosci-s1-pe": null,
    "infosci-s2-pe": null,
    // Concentration courses now live in the concentration layers.
    "infosci-concentration": null,
    // No single CALS row matches these.
    "liberal-studies": null,
    "advisor-elective-open": null,
    "free-elective": null,
  },
  "cornell-comm-bs-2025": {
    "comm-s1-comm1111": `${COMM}:found-navigating-major`,
    "comm-s1-comm1101": `${COMM}:found-intro-comm`,
    "comm-s2-comm1300": `${COMM}:found-visual-comm`,
    "comm-s2-comm2310": `${COMM}:found-writing-comm`,
    "comm-s3-comm2010": `${COMM}:found-oral-comm`,
    "comm-s4-comm2820": `${COMM}:data-research-methods`,
    "comm-stats": `${COMM}:data-statistics`,
    "comm-core-choice": `${COMM}:core-three`,
    "comm-upper": `${COMM}:upper-electives`,
    "comm-practicum": `${COMM}:practicum`,
    "comm-s1-fwis": null,
    "comm-s1-pe": null,
    "comm-s2-pe": null,
    "liberal-studies": null,
    "advisor-elective-open": null,
    "free-elective": null,
  },
};

/** The current id for a stored program id (unchanged unless it is a legacy id). */
export function canonicalProgramId(id: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_PROGRAM_IDS, id) ? LEGACY_PROGRAM_IDS[id] : id;
}

export function isLegacyProgramId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_PROGRAM_IDS, id);
}

/**
 * Waivers saved under `storedProgramId`, translated for its current program.
 * Not a legacy id → returned unchanged. Legacy id → layer-format ids
 * (`layer:row`, already translated or added since) are kept, old ids go
 * through the map, and old ids the map doesn't name are dropped (they can't
 * waive anything on the new program).
 */
export function migrateLegacyWaivers(storedProgramId: string, waivedIds: string[]): string[] {
  const map = LEGACY_WAIVER_MAPS[storedProgramId];
  if (!map || !isLegacyProgramId(storedProgramId)) return waivedIds;
  const known = waivedIds.filter((id) => id.includes(":") || Object.prototype.hasOwnProperty.call(map, id));
  return translateWaivers(known, map);
}
