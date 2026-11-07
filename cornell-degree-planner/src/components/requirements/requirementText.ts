import type { RequirementItem, RequirementNotice } from "@/hooks/useRequirementProgress";
import type { StudentContextNeed } from "@/components/onboarding/StudentContextQuestions";

/**
 * requirementText — the wording the Still-needed panel and the Requirements
 * page (spec 028 D8/D10) share: notices, the concentration prompt, the
 * catalog-year label and a Distribution row's "how far" line. Pure.
 */

/** "2026-27" → "2026–27" (catalog years read with an en dash). */
export function catalogYearLabel(year: string): string {
  return year.replace("-", "–");
}

/** The start question a notice asks for (absent: nothing to ask). */
export const NOTICE_NEED: Partial<Record<RequirementNotice["kind"], StudentContextNeed>> = {
  "needs-entry-term": "entry-term",
  "needs-transfer": "transfer",
  "needs-transfer-standing": "transfer-standing",
};

export const NOTICE_TEXT: Record<RequirementNotice["kind"], string> = {
  "needs-entry-term": "Your college's requirements depend on when you started at Cornell.",
  "needs-transfer": "Your college's requirements depend on whether you transferred in.",
  "needs-transfer-standing": "Your college's requirements depend on the class standing you transferred in at.",
  "layers-unavailable": "This major's requirements couldn't be loaded. Try again later.",
  "under-review": "This major's requirements are being reviewed.",
};

export const CONCENTRATION_TEXT = (min: number, max: number): string =>
  max > 1
    ? `Your major needs ${min === max ? `${max}` : `${min} to ${max}`} concentration${max === 1 ? "" : "s"} before its requirements are complete.`
    : "Your major needs a concentration before its requirements are complete.";

/**
 * The Engineering liberal studies row (spec 037 D9). It is shaped like a
 * distribution row, but it is stated courses first and its categories are
 * called "groups", as Engineering names them: "0 of 3" read first looks like
 * three classes when the requirement is six courses.
 */
export function isEngineeringLiberalStudies(d: RequirementItem["dist"] | null | undefined): boolean {
  return d?.layerId === "engineering" && d.rowId === "liberal-studies";
}

/** "4 of 6 courses · 12 of 18 credits" — the parts a Distribution row states.
 *  Engineering liberal studies: "4 of 6 courses · 13 of 18 credits · 2 of 3 groups". */
export function progressText(d: NonNullable<RequirementItem["dist"]>): string {
  const parts: string[] = [];
  if (isEngineeringLiberalStudies(d)) {
    if (d.coursesNeed != null && d.coursesNeed > 0) {
      parts.push(`${Math.min(d.coursesHave ?? 0, d.coursesNeed)} of ${d.coursesNeed} courses`);
    }
    if (d.creditsNeed != null && d.creditsNeed > 0) {
      parts.push(`${Math.min(d.creditsHave ?? 0, d.creditsNeed)} of ${d.creditsNeed} credits`);
    }
    if (d.categoriesNeed != null) {
      parts.push(`${Math.min(d.categoriesHave ?? 0, d.categoriesNeed)} of ${d.categoriesNeed} groups`);
    }
    return parts.join(" · ");
  }
  if (d.categoriesNeed != null) parts.push(`${d.categoriesHave ?? 0} of ${d.categoriesNeed} categories`);
  if (d.coursesNeed != null && d.coursesNeed > 0 && (d.rowKind !== "seat" || d.categoriesNeed != null)) {
    parts.push(`${d.coursesHave ?? 0} of ${d.coursesNeed} courses`);
  }
  if (d.creditsNeed != null && d.creditsNeed > 0) parts.push(`${d.creditsHave ?? 0} of ${d.creditsNeed} credits`);
  return parts.join(" · ");
}
