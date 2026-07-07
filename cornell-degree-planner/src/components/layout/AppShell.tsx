import { useEffect } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { DragGhost } from "@/components/drag/DragGhost";
import { dragState } from "@/lib/drag/dragState";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useProgramData } from "@/hooks/useProgramData";

function isSlotAvailable(slotId: string, courseId: string): boolean {
  const { slotSelections } = usePlannerStore.getState();
  return !slotSelections[slotId] || slotSelections[slotId] === courseId;
}

export function AppShell() {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { slots, edges, loading, error } = useProgramData(selectedProgramId);

  useEffect(() => {
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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar slots={slots} />
        <div className="relative flex-1">
          <RoadmapCanvas slots={slots} edges={edges} loading={loading} error={error} />
        </div>
      </div>
      <RightSidebar slots={slots} />
      <DragGhost />
    </div>
  );
}
