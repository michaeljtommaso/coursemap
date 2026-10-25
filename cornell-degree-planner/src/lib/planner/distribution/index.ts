import { solveLayers } from "./engine";
import { verifyAssignment } from "./verify";
import type { DistributionResult, SolveInput } from "./types";

/**
 * The Distribution engine as the app calls it (spec 019 D8): the solver with
 * the independent checker wired in, so every "met" a caller sees has been
 * re-proved by verifyAssignment. Callers use `solve`, never `solveLayers`
 * directly.
 */
export function solve(input: SolveInput): DistributionResult {
  return solveLayers(input, { verify: verifyAssignment });
}

export { selectLayers } from "./select";
export { courseMatchesRule } from "./rules";
export type * from "./types";
