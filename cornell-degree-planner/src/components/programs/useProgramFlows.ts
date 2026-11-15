import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import type { HeldBack, OverlapPair, RequirementProgress } from "@/hooks/useRequirementProgress";
import { usePlannerStore } from "@/store/usePlannerStore";
import { MAX_TRIED_COURSES } from "@/lib/schemas";
import { countsForKey } from "@/lib/planner/questions/keys";
import { courseCode } from "@/lib/planner/questions/registry";
import { useMakeRoom } from "@/components/requirements/orphanPrune";
import {
  movedCoursesSentence,
  newlyHeldBack,
  programLayerId,
  programPhrase,
} from "@/components/requirements/programSections";
import { fillToast } from "./programsModel";

type Pending = {
  programId: string;
  shortName: string;
  planId: string | null;
  seen: boolean;
  /** The overlap state just before the add (D8: what the add moved). */
  overlapBefore: readonly OverlapPair[] | undefined;
};

export type ProgramFlowsProgress = Pick<
  RequirementProgress,
  "sections" | "fillCandidates" | "triedOnlyFor" | "overlap" | "groups" | "allLayersLoaded" | "liveLayerIds"
>;

/**
 * The stack's add and remove flows (spec 047 D3, D8, D9, D10).
 *
 * Add: `addProgram`, then — once the engine reports the new program's section
 * as "ok" (its layers loaded and solved) — its still-needed required classes
 * go to Tried (`fillCandidates`, earliest-needed first, up to the cap) and a
 * toast says what happened. A failed load drops the fill with a toast; a plan
 * switch or a removal before the solve lands drops it silently.
 *
 * D8: the same solve may move a shared course OFF a program already on the
 * plan (the overlap limit keeps the most-total-progress assignment). The fill
 * toast then gains a sentence saying so — "ECON 3120 now counts for the CS
 * minor (overlap limit). It can count for Economics instead." with a Switch
 * action — or, for several, "3 courses now count for … You can switch any of
 * them on its card." One toast, fill sentence first: the store shows one at a
 * time, so two toasts would overwrite each other.
 *
 * Remove: `removeProgram` with the tried classes counting only toward it; the
 * plan state shows the "Removed X · Undo" toast.
 *
 * Mount once (the stack is always mounted while a plan is open), with the
 * progress the stack already reads.
 */
export function useProgramFlows(progress: ProgramFlowsProgress) {
  const { planId, additionalPrograms, addProgram, removeProgram, addTriedCourses, setCountsFor } = usePlan();
  const { sections, fillCandidates, triedOnlyFor, overlap, groups } = progress;
  const showToast = usePlannerStore((s) => s.showToast);
  const makeRoom = useMakeRoom(progress);
  const pending = useRef<Pending | null>(null);

  // The Switch action runs later, from the toast: it reads the latest guard
  // and writer, not the ones from the render that showed the toast.
  const latest = useRef({ makeRoom, setCountsFor });
  useEffect(() => {
    latest.current = { makeRoom, setCountsFor };
  }, [makeRoom, setCountsFor]);

  const add = useCallback(
    (p: { programId: string; kind: "major" | "minor"; shortName: string }) => {
      const result = addProgram({ programId: p.programId, kind: p.kind });
      // A refusal is toasted by addProgram itself (PlanProvider owns "never
      // silent"); a second toast here would overwrite it.
      if (result !== "added") return result;
      pending.current = { programId: p.programId, shortName: p.shortName, planId, seen: false, overlapBefore: overlap };
      return result;
    },
    [addProgram, planId, overlap]
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
    const fill = fillToast(shortName, candidates.length, added.length, MAX_TRIED_COURSES);

    // D8: courses this add moved off a program that was already on the plan.
    const moved = newlyHeldBack(p.overlapBefore, overlap, p.programId, sections);
    const phraseOf = (id: string) => {
      const s = sections?.find((x) => x.id === id);
      return s ? programPhrase(s) : id;
    };
    const movedSentence = movedCoursesSentence(moved, phraseOf, courseCode);
    if (!movedSentence) {
      showToast(fill);
      return;
    }
    const message = `${fill} ${movedSentence}`;
    const switchTo = moved.length === 1 ? switchTarget(moved[0], groups) : null;
    if (!switchTo) {
      showToast(message);
      return;
    }
    showToast(message, {
      actionLabel: "Switch",
      onAction: () => {
        const { makeRoom: guard, setCountsFor: write } = latest.current;
        guard("mark", countsForKey(switchTo.layerId, switchTo.courseId), "yes");
        write(switchTo.courseId, switchTo.layerId);
      },
    });
  }, [planId, additionalPrograms, sections, fillCandidates, addTriedCourses, showToast, overlap, groups]);

  const remove = useCallback(
    (programId: string) => {
      if (pending.current?.programId === programId) pending.current = null;
      removeProgram(programId, triedOnlyFor?.[programId] ?? []);
    },
    [removeProgram, triedOnlyFor]
  );

  return { add, remove };
}

/** The course and the layer a Switch writes: the program it was held from. */
function switchTarget(
  h: HeldBack,
  groups: RequirementProgress["groups"] | undefined
): { courseId: string; layerId: string } | null {
  const layerId = programLayerId(groups ?? [], h.heldFrom);
  return layerId ? { courseId: h.courseId, layerId } : null;
}
