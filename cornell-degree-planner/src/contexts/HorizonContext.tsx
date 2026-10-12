import { createContext, useContext } from "react";
import type { HorizonMap, CardHorizon } from "@/hooks/useHorizonMap";

/**
 * HorizonContext (spec 012 §1/§4) — the least-invasive wiring for the card's
 * near-horizon face, mirroring UnlocksContext. RoadmapCanvas computes the
 * HorizonMap once (useHorizonMap) and provides it around the columns; CourseCard
 * reads its placement's entry via `useCardHorizon(placementId)` with NO prop
 * threading through SemesterColumn. Defaults to an empty map so CourseCard
 * renders exactly as today outside the provider (isolation / tests) — every
 * card reads "far".
 */
const EMPTY_MAP: HorizonMap = { byPlacement: {}, targetSlug: null };
const FAR: CardHorizon = {
  horizon: "far",
  offeredThisTerm: false,
  notOfferedThisTerm: false,
  primarySection: null,
  conflictWith: null,
};

export const HorizonContext = createContext<HorizonMap>(EMPTY_MAP);

export function useHorizonContext(): HorizonMap {
  return useContext(HorizonContext);
}

/** This card's horizon entry, defaulting to a far/no-op entry when absent —
 *  so a card outside the provider (or one the map doesn't cover) renders
 *  exactly as today, with zero false claims. */
export function useCardHorizon(placementId: string): CardHorizon {
  return useContext(HorizonContext).byPlacement[placementId] ?? FAR;
}
