import type { MarkValue } from "./distribution/types";
import type { ShareDoc } from "@/lib/schemas";

/**
 * shareContext.ts (spec 020 D6) — what a share link carries for scoring, and
 * how the share view reads it back.
 *
 * A share copies the plan's course marks, the college rule set chosen for the
 * student (a college layer id, e.g. "cals-college-pre2025") and the chosen
 * concentration ids. It never copies the student's facts (`prefs.answers`) or
 * the raw entry term / transfer answers: share links are readable by anyone
 * holding them, and those answers are personal. The resolved rule set is all
 * the share view needs to score the right college version.
 */

/** The scoring inputs a share carries (contract C). */
export type ShareProgressInput = {
  /** The college layer to force in selectLayers; absent on shares written
   *  before spec 020 (the share view then has no rule set to score with). */
  collegeLayerId?: string;
  concentrationIds: string[];
  courseMarks: Record<string, MarkValue>;
};

export function shareProgressInput(
  share: Pick<ShareDoc, "collegeRuleSet" | "concentrationIds" | "courseMarks">
): ShareProgressInput {
  return {
    ...(share.collegeRuleSet ? { collegeLayerId: share.collegeRuleSet } : {}),
    concentrationIds: share.concentrationIds ?? [],
    courseMarks: share.courseMarks ?? {},
  };
}

/** Most concentrations a share records (rules: concentrationIds.size() <= 3). */
const MAX_SHARED_CONCENTRATIONS = 3;

/**
 * The spec 020 fields for a new share. Only fields with something to say are
 * included, so a plan with no marks, rule set or concentration writes the
 * same share shape as before. Deliberately takes no student facts or start
 * answers: there is no way to pass them in.
 */
export function shareAnswerFields(input: {
  courseMarks?: Record<string, MarkValue> | null;
  collegeLayerId?: string | null;
  concentrationIds?: readonly string[] | null;
}): Pick<ShareDoc, "courseMarks" | "collegeRuleSet" | "concentrationIds"> {
  const marks = input.courseMarks ?? {};
  const concentrationIds = [...new Set(input.concentrationIds ?? [])].slice(0, MAX_SHARED_CONCENTRATIONS);
  return {
    ...(Object.keys(marks).length > 0 ? { courseMarks: { ...marks } } : {}),
    ...(input.collegeLayerId ? { collegeRuleSet: input.collegeLayerId } : {}),
    ...(concentrationIds.length > 0 ? { concentrationIds } : {}),
  };
}
