import { useRef, useState } from "react";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { createShare } from "@/services/shares";
import { useRequirementProgress, useStudentAnswers } from "@/hooks/useRequirementProgress";
import { useProgramData } from "@/hooks/useProgramData";
import { shareAnswerFields, shareCollegeRuleSet } from "@/lib/planner/shareContext";
import { courseToSnapshot } from "@/lib/normalize/courseSnapshot";
import { PLAN_SCHEMA_VERSION } from "@/lib/schemas";
import { isDistributionFamily, programFamily } from "@/lib/planner/colleges";

export type ShareStatus = "idle" | "working" | "copied" | "cooldown" | "failed";

/** Share (spec 005 §5): freeze the current plan into an immutable public
 *  snapshot and copy the link. Re-sharing mints a new link. Moved out of the
 *  top bar's Share button into the top-bar menu (spec 039). */
export function useSharePlan(): { canShare: boolean; status: ShareStatus; share: () => Promise<void> } {
  const {
    planId, planName, placements, placedCourses, completedIds, inProgressIds,
    waivedRequirementIds, planProgramId,
  } = usePlan();
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { uid, enteringYear, studentContext } = useAuth();
  // Spec 020 D6: the share carries this plan's course marks, the college rule
  // set chosen for the student (only when the entry term alone picks it — see
  // shareCollegeRuleSet) and the chosen concentrations — never the student's
  // facts or start answers.
  const { marks } = useStudentAnswers();
  const progress = useRequirementProgress();
  // The program the requirements were scored for (same choice as
  // useRequirementProgress), and its layers (cached by ProgramProvider).
  const scoredProgramId = planProgramId ?? selectedProgramId;
  const { layers: scoredLayers } = useProgramData(scoredProgramId);
  const [status, setStatus] = useState<ShareStatus>("idle");
  const lastShareRef = useRef(0);

  const program = programs.find((p) => p.id === selectedProgramId);
  const canShare = !!planId && !!selectedProgramId;

  const handleShare = async () => {
    if (status === "working" || !uid || !program) return;
    // Client-side mirror of the rules cooldown (30s) — UX only; the rules
    // enforce it authoritatively via the lastShareAt batch stamp.
    if (Date.now() - lastShareRef.current < 30_000) {
      setStatus("cooldown");
      setTimeout(() => setStatus("idle"), 2500);
      return;
    }
    setStatus("working");
    try {
      // Snapshot exactly the courses on the board (spec 014 share shape).
      const courseSnapshots: Record<string, unknown> = {};
      for (const p of placements) {
        const c = placedCourses[p.courseId];
        if (c && !courseSnapshots[p.courseId]) courseSnapshots[p.courseId] = courseToSnapshot(c);
      }
      const scoredFamily = programFamily(programs.find((p) => p.id === scoredProgramId));
      const collegeRuleSet =
        progress.engine === "distribution" && scoredProgramId && isDistributionFamily(scoredFamily)
          ? shareCollegeRuleSet(progress.collegeLayerId, {
              layers: scoredLayers,
              family: scoredFamily,
              programId: scoredProgramId,
              entryTerm: studentContext.entryTerm,
            })
          : undefined;
      const shareId = await createShare({
        createdBy: uid,
        planName: planName ?? "Shared plan",
        programId: program.id,
        programName: program.name,
        enteringYear: enteringYear ?? null,
        placements: placements.map((p) => ({
          id: p.id, courseId: p.courseId, sem: p.sem, order: p.order,
        })),
        courseSnapshots,
        completedIds,
        inProgressIds,
        waivedRequirementIds,
        ...shareAnswerFields({
          courseMarks: marks,
          collegeLayerId: collegeRuleSet,
          concentrationIds: progress.engine === "distribution" ? progress.concentrations?.chosen : undefined,
        }),
        schemaVersion: PLAN_SCHEMA_VERSION,
      });
      const url = `${window.location.origin}/s/${shareId}`;
      await navigator.clipboard.writeText(url);
      lastShareRef.current = Date.now();
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      // permission-denied inside the cooldown window = the rules limiter.
      const denied = (err as { code?: string })?.code === "permission-denied";
      console.warn("[share] create failed", err);
      setStatus(denied ? "cooldown" : "failed");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  return { canShare, status, share: handleShare };
}
