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

/** "link" = the share was created but the browser refused the clipboard write;
 *  the link itself is exposed as `url` so the student can copy it by hand. */
export type ShareStatus = "idle" | "working" | "copied" | "link" | "cooldown" | "failed";

export interface SharePlanApi {
  canShare: boolean;
  status: ShareStatus;
  /** The created link while status is "link", otherwise null. */
  url: string | null;
  share: () => Promise<void>;
  /** Retry copying the link shown in the "link" state; resolves true on success. */
  copyLink: () => Promise<boolean>;
  /** Close the "link" state. */
  dismissLink: () => void;
}

/** Share (spec 005 §5): freeze the current plan into an immutable public
 *  snapshot and copy the link. Re-sharing mints a new link. Moved out of the
 *  top bar's Share button into the top-bar menu (spec 039). */
export function useSharePlan(): SharePlanApi {
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
  const [url, setUrl] = useState<string | null>(null);
  const lastShareRef = useRef(0);

  const program = programs.find((p) => p.id === selectedProgramId);
  const canShare = !!planId && !!selectedProgramId;

  const handleShare = async () => {
    if (status === "working" || !uid || !program) return;
    if (status === "link") {
      // Clicking Share again while the link is showing just closes it.
      setUrl(null);
      setStatus("idle");
      return;
    }
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
      const link = `${window.location.origin}/s/${shareId}`;
      // The share exists from here on, so the cooldown starts now and a
      // clipboard refusal is not a failure: show the link instead.
      lastShareRef.current = Date.now();
      let copiedToClipboard = false;
      try {
        await navigator.clipboard.writeText(link);
        copiedToClipboard = true;
      } catch (clipErr) {
        console.warn("[share] clipboard write refused", clipErr);
      }
      if (copiedToClipboard) {
        setStatus("copied");
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setUrl(link);
        setStatus("link");
      }
    } catch (err) {
      // permission-denied inside the cooldown window = the rules limiter.
      const denied = (err as { code?: string })?.code === "permission-denied";
      console.warn("[share] create failed", err);
      setStatus(denied ? "cooldown" : "failed");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  const copyLink = async () => {
    if (!url) return false;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  };

  const dismissLink = () => {
    setUrl(null);
    setStatus((s) => (s === "link" ? "idle" : s));
  };

  return { canShare, status, url: status === "link" ? url : null, share: handleShare, copyLink, dismissLink };
}
