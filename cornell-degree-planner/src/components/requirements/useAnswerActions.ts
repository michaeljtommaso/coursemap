import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlanContext } from "@/contexts/PlanProvider";
import type { FactValue, MarkValue } from "@/lib/planner/distribution/types";

/** Saves (or, with null, clears) one answer. Resolves once the answer is
 *  accepted; rejects with a user-readable Error when it can't be saved. */
export type SaveAnswer = (scope: "mark" | "fact", key: string, value: MarkValue | null) => Promise<void>;

/**
 * useAnswerActions (spec 020 D8) — the one place the Requirements panel writes
 * an answer. A course mark is stored on the plan (`setCourseMark`, saved with
 * the plan's debounced save; its refusals and failures toast from
 * PlanProvider); a student fact is stored on the profile (`setStudentAnswer`,
 * which rejects with a readable message). The row's question form and the
 * "Your answers" list both call through here.
 *
 * `beforeMark` (spec 047 D10) runs right before a course mark is written: the
 * page passes `useMakeRoom`'s guard, which drops orphaned entries when the
 * write would otherwise hit the course-answer cap.
 */
export function useAnswerActions(beforeMark?: (key: string, value: MarkValue | null) => void): SaveAnswer {
  // Marks live on the plan (PlanProvider), facts on the profile (AuthProvider).
  const { setCourseMark } = usePlanContext();
  const { setStudentAnswer } = useAuth();
  return useCallback<SaveAnswer>(
    async (scope, key, value) => {
      if (scope === "mark") {
        beforeMark?.(key, value);
        setCourseMark(key, value);
        return;
      }
      // Facts are yes / no only; a credit value never reaches a fact question.
      if (typeof value === "number") throw new Error("That answer doesn't fit this question.");
      await setStudentAnswer(key, value as FactValue | null);
    },
    [setCourseMark, setStudentAnswer, beforeMark]
  );
}
