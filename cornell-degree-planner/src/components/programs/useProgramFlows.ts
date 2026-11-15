import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";
import { usePlannerStore } from "@/store/usePlannerStore";
import { MAX_TRIED_COURSES } from "@/lib/schemas";
import { addRefusalToast, fillToast } from "./programsModel";

type Pending = { programId: string; shortName: string; planId: string | null; seen: boolean };

/**
 * The stack's add and remove flows (spec 047 D3, D9, D10).
 *
 * Add: `addProgram`, then — once the engine reports the new program's section
 * as "ok" (its layers loaded and solved) — its still-needed required classes
 * go to Tried (`fillCandidates`, earliest-needed first, up to the cap) and a
 * toast says what happened. A failed load drops the fill with a toast; a plan
 * switch or a removal before the solve lands drops it silently.
 *
 * Remove: `removeProgram` with the tried classes counting only toward it; the
 * plan state shows the "Removed X · Undo" toast.
 *
 * Mount once (the stack is always mounted while a plan is open), with the
 * progress the stack already reads.
 */
export function useProgramFlows(progress: Pick<RequirementProgress, "sections" | "fillCandidates" | "triedOnlyFor">) {
  const { planId, additionalPrograms, addProgram, removeProgram, addTriedCourses } = usePlan();
  const { sections, fillCandidates, triedOnlyFor } = progress;
  const showToast = usePlannerStore((s) => s.showToast);
  const pending = useRef<Pending | null>(null);

  const add = useCallback(
    (p: { programId: string; kind: "major" | "minor"; shortName: string }) => {
      const result = addProgram({ programId: p.programId, kind: p.kind });
      if (result !== "added") {
        showToast(addRefusalToast(result, p.shortName, p.kind));
        return result;
      }
      pending.current = { programId: p.programId, shortName: p.shortName, planId, seen: false };
      return result;
    },
    [addProgram, showToast, planId]
  );

  // The fill waits for the solve that includes the new program.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (p.planId !== planId) {
      pending.current = null;
      return;
    }
    // Removed again before its solve landed (the add itself may reach the
    // plan state a render later, so only a program seen and then gone counts).
    const onPlan = additionalPrograms.some((a) => a.programId === p.programId);
    if (!onPlan) {
      if (p.seen) pending.current = null;
      return;
    }
    p.seen = true;
    const section = sections?.find((s) => s.id === p.programId);
    if (!section || section.status === "loading") return;
    pending.current = null;
    const shortName = section.shortName || p.shortName;
    if (section.status === "unavailable") {
      showToast(`Couldn't load ${shortName}'s requirements right now, so nothing was added to Tried.`);
      return;
    }
    const candidates = fillCandidates?.[p.programId] ?? [];
    const { added } = candidates.length > 0 ? addTriedCourses(candidates) : { added: [] as string[] };
    showToast(fillToast(shortName, candidates.length, added.length, MAX_TRIED_COURSES));
  }, [planId, additionalPrograms, sections, fillCandidates, addTriedCourses, showToast]);

  const remove = useCallback(
    (programId: string) => {
      if (pending.current?.programId === programId) pending.current = null;
      removeProgram(programId, triedOnlyFor?.[programId] ?? []);
    },
    [removeProgram, triedOnlyFor]
  );

  return { add, remove };
}
