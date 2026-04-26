import { useState } from "react";
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramMap } from "@/hooks/useProgramMap";

export function AppShell() {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const planCourse = usePlannerStore((state) => state.planCourse);
  const program = useProgramMap();

  const activeNode = activeNodeId && program
    ? program.nodes.find((n) => n.id === activeNodeId)
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveNodeId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveNodeId(null);
    if (!over) return;
    let rawId = String(over.id);
    // Strip component-specific prefixes used to avoid duplicate droppable IDs
    if (rawId.startsWith("rmap:")) rawId = rawId.slice(5);
    else if (rawId.startsWith("plan:")) rawId = rawId.slice(5);
    const parts = rawId.split(":");
    if (parts.length < 2) return;
    const slot = parseInt(parts[parts.length - 1]);
    const termId = parts.slice(0, -1).join(":");
    if (!isNaN(slot)) {
      planCourse(String(active.id), termId, slot);
    }
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="min-h-screen bg-background text-foreground">
        <TopBar />
        <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 p-4">
          <LeftSidebar />
          <div className="space-y-4">
            <RoadmapCanvas />
            <PlannerPanel />
          </div>
        </div>
        <RightSidebar />
      </div>
      <DragOverlay>
        {activeNode ? (
          <div className="rounded-2xl border border-blue-300 bg-blue-50 px-3 py-2 shadow-lg text-sm font-semibold text-slate-900">
            {activeNode.code ?? activeNode.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
