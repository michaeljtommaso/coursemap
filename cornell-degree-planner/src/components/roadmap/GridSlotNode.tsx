import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequirementNode, NodeStatus } from "@/types/curriculum";
import { usePlannerStore } from "@/store/usePlannerStore";
import { CARD_W, CARD_H } from "@/lib/graph/buildRoadmapGrid";

const statusStyles: Record<NodeStatus, string> = {
  completed: "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/50",
  planned: "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/50",
  available: "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50",
  locked: "border-border bg-muted/40",
  waived: "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/50",
};

export function GridSlotNode({ data }: NodeProps) {
  const { termId, slot, course, status } = data as {
    termId: string;
    slot: number;
    course: RequirementNode | null;
    status: NodeStatus | null;
  };

  const unplanCourse = usePlannerStore((s) => s.unplanCourse);
  const slotId = `rmap:${termId}:${slot}`;

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: slotId });
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: course?.id ?? `empty-${slotId}`,
    disabled: !course,
  });

  return (
    <>
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />

      <div
        ref={setDropRef}
        style={{ width: CARD_W, height: CARD_H }}
        className={cn(
          "rounded-lg border transition-colors",
          !course &&
            (isOver
              ? "border-solid border-blue-400 bg-blue-50 dark:bg-blue-950/40"
              : "border-dashed border-border bg-transparent hover:bg-muted/30"),
          course && (status ? statusStyles[status] : "border-border bg-card")
        )}
      >
        {!course && isOver && (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs font-medium text-blue-500">Drop here</span>
          </div>
        )}

        {course && (
          // nopan tells React Flow: don't start a canvas pan when pointer lands here
          <div className={cn("nopan relative h-full", isDragging && "opacity-50")}>
            {/* X button sits outside the drag handle so clicks reach it cleanly */}
            <button
              onClick={() => unplanCourse(course.id)}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100"
              aria-label="Remove"
            >
              <X className="h-3 w-3" />
            </button>

            {/* Drag handle covers the rest of the card */}
            <div
              ref={setDragRef}
              {...attributes}
              {...listeners}
              className="nopan flex h-full flex-col justify-center gap-0.5 px-2.5 py-2 pr-6 cursor-grab active:cursor-grabbing"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
                {course.code ?? course.type}
              </p>
              <p className="text-xs font-medium text-foreground leading-snug">
                {course.title}
              </p>
              {course.credits && (
                <p className="text-[10px] text-muted-foreground">{course.credits} cr</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
