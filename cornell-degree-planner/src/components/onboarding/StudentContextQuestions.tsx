/**
 * StudentContextQuestions (spec 019 D10, Phase 2 deviation 7) — asks what
 * selectLayers needs: the start term, whether the student transferred in, and
 * the class standing a transfer arrived at. Writes through
 * useAuth().setStudentContext; never guesses an answer.
 *
 * CONTRACT (Phase 3, lane C implements; stub until then). Used by FirstRun
 * and, inline, by the Requirements panel when a Distribution program's
 * selection needs an answer (RequirementProgress.notice).
 */
export type StudentContextNeed = "entry-term" | "transfer" | "transfer-standing";

export function StudentContextQuestions(props: {
  /** Ask only this question (the panel's inline use); absent → ask every
   *  question still unanswered, in order. */
  need?: StudentContextNeed;
  /** Inline panel styling (tight, no heading). */
  compact?: boolean;
  /** Called once the asked question(s) are answered and saved. */
  onDone?: () => void;
}) {
  void props;
  return null;
}
