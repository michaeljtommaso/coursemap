import { useEffect, useRef } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { DragGhost } from "@/components/drag/DragGhost";
import { dragState } from "@/lib/drag/dragState";
import { usePlan } from "@/hooks/usePlan";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramData } from "@/hooks/useProgramData";
import { useEffectiveSlots } from "@/hooks/useEffectiveSlots";

export function AppShell() {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { slots, edges, loading, error, refetch } = useProgramData(selectedProgramId);
  // Single merge point for plan-level slot edits (spec 005 §9) — everything
  // below the shell sees the student's roadmap, not the raw template.
  const { effectiveSlots, hiddenBySem } = useEffectiveSlots(slots);

  // Plan slotSelections now live in PlanProvider (context, not a global store).
  // The pointerup drop handler runs from a mount-once effect, so mirror the
  // current selections into a ref it can read synchronously at drop time.
  const { slotSelections } = usePlan();
  const slotSelectionsRef = useRef(slotSelections);
  slotSelectionsRef.current = slotSelections;

  useEffect(() => {
    const isSlotAvailable = (slotId: string, courseId: string): boolean => {
      const sel = slotSelectionsRef.current;
      return !sel[slotId] || sel[slotId] === courseId;
    };

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
      const targetSlotId =
        ds.overSlotId && ds.courseId && isSlotAvailable(ds.overSlotId, ds.courseId)
          ? ds.overSlotId
          : null;
      // No slot under the pointer → a column background re-homes the course
      // into a new custom slot there (spec 005 §9).
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
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar slots={effectiveSlots} />
        <div className="relative flex-1">
          <RoadmapCanvas
            slots={effectiveSlots}
            hiddenBySem={hiddenBySem}
            edges={edges}
            loading={loading}
            error={error}
            onRetry={refetch}
          />
        </div>
      </div>
      <RightSidebar slots={effectiveSlots} />
      <DragGhost />
    </div>
  );
}
