import { useEffect, useRef } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { DragGhost } from "@/components/drag/DragGhost";
import { dragState } from "@/lib/drag/dragState";
import { usePlan } from "@/hooks/usePlan";
import { useProgramStore } from "@/store/useProgramStore";
import { useProgramData } from "@/hooks/useProgramData";

export function AppShell() {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { slots, edges, loading, error, refetch } = useProgramData(selectedProgramId);

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

    const handleMove = (e: PointerEvent) => dragState.move(e.clientX, e.clientY);

    const handleUp = () => {
      const ds = dragState.get();
      if (!ds || ds.phase !== "dragging") return;

      const targetSlotId =
        ds.overSlotId && isSlotAvailable(ds.overSlotId, ds.courseId)
          ? ds.overSlotId
          : null;
      dragState.startDrop(targetSlotId);
    };

    const handleCancel = () => {
      if (dragState.get()) dragState.startDrop(null);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleCancel);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleCancel);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar slots={slots} />
        <div className="relative flex-1">
          <RoadmapCanvas
            slots={slots}
            edges={edges}
            loading={loading}
            error={error}
            onRetry={refetch}
          />
        </div>
      </div>
      <RightSidebar slots={slots} />
      <DragGhost />
    </div>
  );
}
