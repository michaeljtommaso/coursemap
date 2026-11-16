import type { ProgramColor } from "@/hooks/useRequirementProgress";

/** Literal Tailwind class names per program color (spec 047 D5), written out
 *  so Tailwind generates them. The primary uses the ink equivalents. */
export const PROGRAM_STROKE: Record<ProgramColor, string> = {
  1: "stroke-program-1",
  2: "stroke-program-2",
  3: "stroke-program-3",
  4: "stroke-program-4",
};
export const PROGRAM_BG: Record<ProgramColor, string> = {
  1: "bg-program-1",
  2: "bg-program-2",
  3: "bg-program-3",
  4: "bg-program-4",
};
