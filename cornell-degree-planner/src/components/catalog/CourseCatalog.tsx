import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useProgramMap } from "@/hooks/useProgramMap";
import { usePlannerStore } from "@/store/usePlannerStore";
import { evaluateNodeStatus } from "@/lib/graph/evaluateNodeStatus";
import { cn } from "@/lib/utils";
import type { RequirementNode, NodeStatus } from "@/types/curriculum";

const chipStyles: Record<NodeStatus, string> = {
  available: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  planned:   "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  locked:    "border-border bg-muted/40 text-muted-foreground",
  waived:    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
};

function DraggableChip({ node, status }: { node: RequirementNode; status: NodeStatus }) {
  const draggable = status !== "locked" && status !== "completed" && status !== "waived";
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: node.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[10px] font-medium leading-tight transition-opacity",
        chipStyles[status],
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        isDragging && "opacity-40"
      )}
    >
      <span className="font-semibold">{node.code ?? node.type}</span>
      <span className="block truncate text-[9px] opacity-70 mt-0.5">{node.title}</span>
    </div>
  );
}

export function CourseCatalog() {
  const program = useProgramMap();
  const completed = usePlannerStore((s) => s.completed);
  const planned = usePlannerStore((s) => s.planned);
  const plannedSlots = usePlannerStore((s) => s.plannedSlots);
  const waived = usePlannerStore((s) => s.waived);

  const plan = useMemo(
    () => ({ completed, planned, plannedSlots, waived }),
    [completed, planned, plannedSlots, waived]
  );

  const unplacedCourses = useMemo(() => {
    if (!program) return [];
    const placedIds = new Set(Object.values(plannedSlots));
    return program.nodes
      .filter((n) => !placedIds.has(n.id))
      .map((n) => ({ node: n, status: evaluateNodeStatus(n, plan) }))
      .sort((a, b) => {
        const order: NodeStatus[] = ["available", "planned", "locked", "completed", "waived"];
        return order.indexOf(a.status) - order.indexOf(b.status);
      });
  }, [program, plan, plannedSlots]);

  if (!program) return null;

  return (
    <div className="rounded-2xl bg-card border border-border px-3 py-3 shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Courses
      </p>
      <p className="mb-2.5 text-[10px] text-muted-foreground">Drag to a roadmap slot</p>
      {unplacedCourses.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">All courses placed</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {unplacedCourses.map(({ node, status }) => (
            <DraggableChip key={node.id} node={node} status={status} />
          ))}
        </div>
      )}
    </div>
  );
}
