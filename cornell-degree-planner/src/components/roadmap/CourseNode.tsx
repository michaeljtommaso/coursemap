import { Handle, Position } from "@xyflow/react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export function CourseNode({ data }: { data: any }) {
  const isDraggable = data.status === "available" || data.status === "planned" || data.status === "completed";

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: data.id,
    disabled: !isDraggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
      className={cn(
        "min-w-[180px] rounded-2xl border bg-card p-3 shadow-sm transition",
        data.status === "completed" && "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/60",
        data.status === "planned" && "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/60",
        data.status === "available" && "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60",
        data.status === "locked" && "border-border bg-muted/60",
        data.status === "waived" && "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/60",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{data.code ?? "Course"}</p>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{data.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{data.credits ? `${data.credits} credits` : ""}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
