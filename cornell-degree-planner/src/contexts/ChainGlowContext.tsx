import { createContext, useContext } from "react";

/**
 * ChainGlowContext — which board cards glow while a card is hovered or
 * focused: the hovered card itself and every card its wires point to (the
 * courses it feeds). RoadmapCanvas derives the set from the hovered placement
 * and the derived edges; CourseCard reads it via `useChainGlow()` without prop
 * threading through SemesterColumn. Defaults to an empty set, so a card
 * rendered outside the provider simply never glows.
 */
export type ChainGlow = {
  /** The hovered/focused placement, or null. */
  source: string | null;
  /** Placements its outgoing wires point to. */
  targets: ReadonlySet<string>;
};

const NO_GLOW: ChainGlow = { source: null, targets: new Set() };

export const ChainGlowContext = createContext<ChainGlow>(NO_GLOW);

export function useChainGlow(): ChainGlow {
  return useContext(ChainGlowContext);
}
