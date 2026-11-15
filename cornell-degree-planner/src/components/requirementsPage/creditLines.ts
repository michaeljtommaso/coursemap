import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import { visibleCreditText, type MajorRef } from "@/lib/credit/limitScope";
import { collegeShortName } from "@/lib/planner/colleges";
import { creditProfileCredits } from "@/lib/planner/creditPool";
import { codeFromId } from "./pageModel";

/** The Credit before Cornell group's wording (spec 028 D7, spec 045 D6). Pure. */

export const CREDIT_CARD_KEY = "credit";

/** Counts as, for a credit with no specific Cornell course (spec 045 D6). */
export const ELECTIVE_CREDIT_TEXT = "Elective credit · ask your major how it counts";

export function formatCr(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Total credits the student brings (entries that earn something here), each
 *  Cornell course counted once: two exams granting the same course (AP
 *  Chemistry and A-Level Chemistry) add that course's credits once, the same
 *  figure as the rail's credit line and the degree total. */
export function creditTotal(resolved: readonly ResolvedCredit[]): number {
  return creditProfileCredits(resolved.filter((c) => !c.earnsNothing));
}

/** The Cornell courses a credit grants, as codes: "MATH 1110 + MATH 1120",
 *  Cornell's "X or Y", or "one of N courses (…)". Null with no course. */
export function creditCourses(c: ResolvedCredit): string | null {
  const opts = c.courseOptions?.filter((o) => o.length > 0) ?? [];
  if (opts.length > 1) {
    // Cornell's "X or Y": two short options read in full; a long placement
    // list reads as "one of N courses (first two, …)".
    return opts.length === 2
      ? opts.map((o) => o.map(codeFromId).join(" + ")).join(" or ")
      : `one of ${opts.length} courses (${opts
          .slice(0, 2)
          .map((o) => o.map(codeFromId).join(" + "))
          .join(", ")}, …)`;
  }
  const codes = c.satisfiesCourseIds.map(codeFromId);
  return codes.length > 0 ? codes.join(" + ") : null;
}

/** The line under a credit's name: "MATH 1910 · 4 cr", "Placement out of …". */
export function creditEarns(c: ResolvedCredit, college: CreditCollege): string {
  if (c.earnsNothing) return noCreditText(college);
  if (c.placementOnly) {
    const codes = c.satisfiesCourseIds.map(codeFromId);
    return codes.length > 0 ? `Placement out of ${codes.join(", ")} · no credit` : "Placement only · no credit";
  }
  const cr = c.credits != null ? `${formatCr(c.credits)} cr` : "";
  const courses = creditCourses(c);
  if (courses) return cr ? `${courses} · ${cr}` : courses;
  return cr ? `${cr} (no specific course)` : "Counts toward your credit total";
}

function noCreditText(college: CreditCollege): string {
  return college ? `No credit in ${collegeShortName(college)}` : "No credit at this score";
}

/** The Credit column: "AP Biology · 5" for an exam, "Transfer · MATH 1920"
 *  for a transfer course, else the saved label. */
export function creditName(c: ResolvedCredit): string {
  if (c.source.kind === "exam") {
    const { displayName, score } = c.source;
    const suffix = ` (${score})`;
    const name = displayName.endsWith(suffix) ? displayName.slice(0, -suffix.length) : displayName;
    return `${name} · ${score}`;
  }
  if (c.kind === "transfer" || c.source.kind === "transfer") {
    return `Transfer · ${c.label.replace(/ \(transfer\)$/, "")}`;
  }
  return c.label;
}

/** The Credits column: "4 cr", or "—" when it earns no credit here. */
export function creditCreditsText(c: ResolvedCredit): string {
  if (c.earnsNothing || c.placementOnly || c.credits == null) return "—";
  return `${formatCr(c.credits)} cr`;
}

export type CountsAs = {
  text: string;
  /** fills: requirements on this page; courses: the Cornell courses it
   *  earns; elective: no specific course; none: no credit here. */
  kind: "fills" | "courses" | "elective" | "none";
};

/** The Counts as column (spec 045 D6): the requirements it fills here, else
 *  the Cornell courses it earns, else elective credit. */
export function creditCountsAs(
  c: ResolvedCredit,
  college: CreditCollege,
  filled: readonly string[] | undefined
): CountsAs {
  if (c.earnsNothing) return { text: noCreditText(college), kind: "none" };
  if (filled && filled.length > 0) return { text: filled.join(", "), kind: "fills" };
  if (c.placementOnly) return { text: creditEarns(c, college), kind: "courses" };
  const courses = creditCourses(c);
  if (courses) return { text: courses, kind: "courses" };
  return { text: ELECTIVE_CREDIT_TEXT, kind: "elective" };
}

/** Below this, a credit difference is rounding, not a part worth naming. */
const EPS = 0.001;

/** The group header's figure (spec 045 D6): always the full total, the same
 *  "27 cr" the outline and the credit dialog show, plus "· 18 count in CALS"
 *  when some of it doesn't count (creditCount.counted); null with no credit.
 *  Why the two differ is the amber line's (creditCapText). */
export function creditHeaderText(
  resolved: readonly ResolvedCredit[],
  college: CreditCollege,
  creditCount: { counted: number; total: number } | undefined
): string | null {
  const total = creditTotal(resolved);
  if (creditCount && creditCount.counted < total - EPS) {
    const where = college ? `in ${collegeShortName(college)}` : "toward your degree";
    return `${formatCr(total)} cr · ${formatCr(creditCount.counted)} count ${where}`;
  }
  return total > 0 ? `${formatCr(total)} cr` : null;
}

/** The college's own limit sentence(s) on credit before Cornell, said once
 *  under the header (spec 045 D6) whenever the student has any credit, over
 *  the cap or not (CALS: "At most 15 credits … count"). Null when the college
 *  states none or there is no credit. */
export function creditRuleText(collegeLimits: readonly string[], hasCredit: boolean): string | null {
  return hasCredit && collegeLimits.length > 0 ? collegeLimits.join(" ") : null;
}

/** The amber line (spec 045 D6): why the header's "N count" is less than its
 *  total, in parts, each said only when it isn't zero:
 *  - credit for a Cornell course that is also on the board, which the
 *    requirements count once, as the course (total − creditCount.total);
 *  - credit over the college's limit (creditCount.total − counted).
 *  "8 cr are for courses already on your board, so they aren't counted
 *  twice. 1 cr is over CALS's limit." The college's own sentence is the rule
 *  line's (creditRuleText). Null when nothing is left out, or with no
 *  creditCount (a college that reports none, like Engineering). */
export function creditCapText(
  resolved: readonly ResolvedCredit[],
  college: CreditCollege,
  creditCount: { counted: number; total: number } | undefined
): string | null {
  if (!creditCount) return null;
  const board = Math.max(0, creditTotal(resolved) - creditCount.total);
  const over = Math.max(0, creditCount.total - creditCount.counted);
  const parts: string[] = [];
  if (board > EPS) {
    parts.push(
      board === 1
        ? "1 cr is for a course already on your board, so it isn't counted twice."
        : `${formatCr(board)} cr are for courses already on your board, so they aren't counted twice.`
    );
  }
  if (over > EPS) {
    const whose = college ? `${collegeShortName(college)}'s` : "your college's";
    parts.push(`${formatCr(over)} cr ${over === 1 ? "is" : "are"} over ${whose} limit.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** A credit's own limit lines and note for its row: the lines for this major
 *  (visibleCreditText), without the college-wide sentences the rule line
 *  already says once. A credit that earns nothing here shows only its note. */
export function creditRowNotes(
  c: ResolvedCredit,
  major: MajorRef | null,
  filled: readonly string[] | undefined,
  collegeLimits: readonly string[]
): { limits: string[]; note?: string } {
  const shown = visibleCreditText(c, major, filled);
  const college = new Set(collegeLimits);
  const limits = c.earnsNothing ? [] : shown.limits.filter((l) => !college.has(l));
  return shown.note ? { limits, note: shown.note } : { limits };
}
