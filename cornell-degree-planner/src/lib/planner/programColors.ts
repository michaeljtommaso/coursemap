import type { ProgramColor } from "@/hooks/useRequirementProgress";

/**
 * programColors.ts (spec 047 D5) — the color of each extra program on a plan.
 * The primary major is ink and the college has none; the second major and
 * minors take, in the order they were added, teal, indigo, pink, slate
 * (`--program-1..4` in styles/tokens.css, each with `-tint` / `-text` like
 * the status triads). Never a status color.
 */

/** Color tokens per program color. */
export const PROGRAM_COLOR_VAR: Record<ProgramColor, string> = {
  1: "var(--program-1)",
  2: "var(--program-2)",
  3: "var(--program-3)",
  4: "var(--program-4)",
};

/** The color of the program at `index` in the plan's `additionalPrograms`
 *  (0-based). A list holds at most four; anything past (or a bad index)
 *  wraps rather than throwing. */
export function programColorFor(index: number): ProgramColor {
  const i = Number.isInteger(index) && index >= 0 ? index % 4 : 0;
  return (i + 1) as ProgramColor;
}
