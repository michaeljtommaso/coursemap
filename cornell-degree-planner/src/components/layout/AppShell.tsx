import { useEffect } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { CourseDetailPanel } from "@/components/course/CourseDetailPanel";
import { DragGhost } from "@/components/drag/DragGhost";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { CreditsDialog } from "@/components/auth/CreditsDialog";
import { Toast } from "@/components/ui/Toast";
import { dragState } from "@/lib/drag/dragState";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramData } from "@/hooks/useProgramData";
import { useEffectiveSlots } from "@/hooks/useEffectiveSlots";

export function AppShell() {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { slots, loading, error, refetch } = useProgramData(selectedProgramId);
  const signInOpen = usePlannerStore((s) => s.signInOpen);
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const creditsOpen = usePlannerStore((s) => s.creditsOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);
  // Single merge point for plan-level slot edits (spec 005 §9) — everything
  // below the shell sees the student's roadmap, not the raw template.
  const { effectiveSlots, hiddenBySem } = useEffectiveSlots(slots);

  useEffect(() => {
    // Edge auto-scroll (spec 004 §1): dragging near the canvas edge scrolls it,
    // so off-screen semesters are reachable drop targets. rAF loop while armed.
    const EDGE = 56;
    const SPEED = 14;
    let scrollRaf = 0;
    let scrollVel = 0;
    const scrollLoop = () => {
      const scroller = document.querySelector<HTMLElement>("[data-canvas-scroll]");
      if (scroller && scrollVel !== 0 && dragState.get()?.phase === "dragging") {
        scroller.scrollLeft += scrollVel;
        scrollRaf = requestAnimationFrame(scrollLoop);
      } else {
        scrollRaf = 0;
      }
    };

    const handleMove = (e: PointerEvent) => {
      dragState.move(e.clientX, e.clientY);
      if (dragState.get()?.phase !== "dragging") return;
      const scroller = document.querySelector<HTMLElement>("[data-canvas-scroll]");
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      scrollVel =
        e.clientX > r.right - EDGE
          ? SPEED
          : e.clientX < r.left + EDGE
            ? -SPEED
            : 0;
      if (scrollVel !== 0 && !scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop);
    };

    const handleUp = () => {
      scrollVel = 0;
      const ds = dragState.get();
      if (!ds || ds.phase !== "dragging") return;

      if (ds.mode === "slot") {
        // Slot moves land on column backgrounds only.
        dragState.startDrop(null, ds.overColumnSem);
        return;
      }
      // Drops never lie (spec 009 §2 / #5): a drop ON a slot ALWAYS targets that
      // slot — no occupancy gate. Landing on an occupied slot is a REPLACE
      // (assignSlot handles the incumbent + undo toast). The overColumnSem
      // fallback fires ONLY when the pointer is over no slot at all (genuine
      // column background), never as a rejected-slot diversion.
      const targetSlotId = ds.overSlotId && ds.courseId ? ds.overSlotId : null;
      dragState.startDrop(targetSlotId, targetSlotId ? null : ds.overColumnSem);
    };

    const handleCancel = () => {
      scrollVel = 0;
      if (dragState.get()) dragState.startDrop(null);
    };

    // Esc disarms click-to-place (spec 004 §4).
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") usePlannerStore.getState().disarm();
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleCancel);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleCancel);
      document.removeEventListener("keydown", handleKey);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/*
       * TopBar applies `backdrop-blur` (backdrop-filter) on its own root
       * element, which per spec makes TopBar a stacking context AND a
       * containing block for its position:fixed/absolute descendants —
       * including the "Your plans" plan-switcher dropown in PlanMenu. That
       * traps the dropdown's z-index comparisons *inside* TopBar's local
       * context: it can never out-rank a later sibling here (the roadmap
       * canvas, RightSidebar) no matter how high its own z-index climbs,
       * because TopBar itself paints at its natural (unstacked) position in
       * this flex column, which is *before* those siblings in DOM order.
       *
       * Fix: give the wrapper around TopBar its own explicit stacking
       * position at this root level (`relative` + `isolate` + a z-index from
       * the shared scale in tokens.css), higher than RightSidebar's panel
       * layer. That lets TopBar's entire (locally-trapped) subtree — dropdown
       * included — paint as one unit above the canvas and RightSidebar,
       * without needing to touch TopBar.tsx itself.
       */}
      <div className="relative isolate z-[var(--z-topbar)]">
        <TopBar />
      </div>
      {/* relative: the RightSidebar drawer anchors to THIS row (absolute,
          inset-y-0) so it always starts exactly below the top bar — it must
          never cover the header's Reset / Save / theme controls. */}
      <div className="relative flex min-h-0 flex-1">
        <LeftSidebar slots={effectiveSlots} />
        <div className="relative flex-1">
          <RoadmapCanvas
            slots={effectiveSlots}
            hiddenBySem={hiddenBySem}
            loading={loading}
            error={error}
            onRetry={refetch}
          />
        </div>
        <RightSidebar slots={effectiveSlots} />
      </div>
      {/* Course detail side-peek (spec 006 §D4) — a global overlay driven by
          usePlannerStore.detailCourse; slots feed its pools + "counts toward". */}
      <CourseDetailPanel slots={effectiveSlots} />
      <DragGhost />
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <Toast />
    </div>
  );
}
