import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequirementNode, NodeStatus } from "@/types/curriculum";

interface PlannerSlotProps {
  termId: string;
  slot: number;
  course: RequirementNode | null;
  status: NodeStatus | null;
  onRemove: (nodeId: string) => void;
}

const statusStyles: Record<NodeStatus, string> = {
  completed: "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/50",
  planned:   "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/50",
  available: "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50",
  locked:    "border-border bg-muted/40",
  waived:    "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/50",
};

export function PlannerSlot({ termId, slot, course, status, onRemove }: PlannerSlotProps) {
  const id = `${termId}:${slot}`;
  const { setNodeRef, isOver } = useDroppable({ id });

  if (!course) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-[76px] items-center justify-center rounded-lg border border-dashed transition-colors",
          isOver
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
            : "border-border bg-transparent hover:bg-muted/30"
        )}
      >
        {isOver && (
          <span className="text-xs font-medium text-blue-500">Drop here</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-[76px] flex-col justify-center rounded-lg border px-2.5 py-2 transition-colors",
        status ? statusStyles[status] : "border-border bg-card"
      )}
    >
      <button
        onClick={() => onRemove(course.id)}
        className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100"
        aria-label="Remove"
      >
        <X className="h-3 w-3" />
      </button>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
        {course.code ?? course.type}
      </p>
      <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
        {course.title}
      </p>
      {course.credits && (
        <p className="text-[10px] text-muted-foreground mt-0.5">{course.credits} cr</p>
      )}
    </div>
  );
}
