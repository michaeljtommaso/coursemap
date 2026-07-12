import { createContext, useContext } from "react";
import type { HorizonMap, SlotHorizon } from "@/hooks/useHorizonMap";

/**
 * HorizonContext (spec 012 §1/§4) — the least-invasive wiring for the card's
 * near-horizon face, mirroring UnlocksContext. RoadmapCanvas computes the
 * HorizonMap once (useHorizonMap) and provides it around the columns; SlotCard
 * reads its slot's entry via `useSlotHorizon(slotId)` with NO prop threading
 * through SemesterColumn. Defaults to an empty map so SlotCard renders exactly
 * as today outside the provider (isolation / tests) — every slot reads "far".
 */
const EMPTY_MAP: HorizonMap = { bySlot: {}, targetSlug: null };
const FAR: SlotHorizon = {
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

/** This slot's horizon entry, defaulting to a far/no-op entry when absent —
 *  so a card outside the provider (or a slot the map doesn't cover) renders
 *  exactly as today, with zero false claims. */
export function useSlotHorizon(slotId: string): SlotHorizon {
  return useContext(HorizonContext).bySlot[slotId] ?? FAR;
}
