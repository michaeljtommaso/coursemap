import { createContext, useContext } from "react";
import type { UnlocksMap } from "@/lib/planner/unlocks";

/**
 * UnlocksContext (spec 008 §3b, Unit 8C) — the least-invasive wiring for the
 * card's quiet "unlocks N" count. RoadmapCanvas builds the UnlocksMap once
 * (buildUnlocksMap over the catalog index) and provides it around the columns;
 * CourseCard reads it via `useUnlocksMap()` without any prop threading through
 * SemesterColumn. Defaults to an empty map so CourseCard renders fine outside the
 * provider (e.g. in isolation / tests) — the count simply reads 0.
 */
const EMPTY_UNLOCKS: UnlocksMap = new Map();

export const UnlocksContext = createContext<UnlocksMap>(EMPTY_UNLOCKS);

export function useUnlocksMap(): UnlocksMap {
  return useContext(UnlocksContext);
}
