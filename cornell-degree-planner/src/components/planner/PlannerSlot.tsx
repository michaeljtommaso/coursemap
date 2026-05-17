import { useRef, useEffect, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import type { RequirementNode, NodeStatus } from "@/types/curriculum";
import { dragState } from "@/lib/drag/dragState";

interface PlannerSlotProps {
  termId: string;
  slot: number;
  course: RequirementNode | null;
  status: NodeStatus | null;
  onRemove: (nodeId: string) => void;
}

const statusStyles: Record<NodeStatus, string> = {
  completed:
    "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/50",
  planned:
    "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/50",
  available:
    "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50",
  locked: "border-border bg-muted/40",
  waived:
    "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/50",
};

export function PlannerSlot({
  termId,
  slot,
  course,
  status,
  onRemove,
}: PlannerSlotProps) {
  const slotId = `${termId}:${slot}`;

  const cardRef = useRef<HTMLDivElement>(null);
  const prevCourseId = useRef<string | null>(null);

  const isOver = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.overSlotId === slotId && !course
  );

  const isDraggingThis = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.courseId === course?.id
  );

  // Spring entrance when a course lands here
  useEffect(() => {
    const wasEmpty = prevCourseId.current === null;
    const isNowFilled = course !== null;
    prevCourseId.current = course?.id ?? null;

    if (wasEmpty && isNowFilled && cardRef.current) {
      animate(cardRef.current, {
        scale: [0.65, 1.06, 1.0],
        opacity: [0, 1],
        ease: spring({ bounce: 0.4, duration: 480 }),
      });
    }
  }, [course?.id]);

  // Hover lift (suppressed during an active drag)
  useEffect(() => {
    if (!cardRef.current || !course) return;
    const el = cardRef.current;

    const onEnter = () => {
      if (dragState.get()) return;
      animate(el, { y: -4, duration: 140, ease: "out(2)" });
    };
    const onLeave = () => animate(el, { y: 0, duration: 180, ease: "out(2)" });

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [course?.id]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!course) return;
    e.preventDefault();
    dragState.start({
      courseId: course.id,
      sourceSlotId: slotId,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  const showEmpty = !course || isDraggingThis;

  return (
    <div
      data-slot={slotId}
      className={cn(
        "relative h-[90px] rounded-lg border transition-colors",
        showEmpty
          ? isOver
            ? "flex items-center justify-center border-solid border-blue-400 bg-blue-50 dark:bg-blue-950/40"
            : "flex items-center justify-center border-dashed border-border bg-transparent hover:bg-muted/30"
          : status
          ? statusStyles[status]
          : "border-border bg-card"
      )}
    >
      {showEmpty && isOver && (
        <span className="text-xs font-medium text-blue-500">Drop here</span>
      )}

      {!showEmpty && course && (
        <div ref={cardRef} className="relative flex h-full flex-col justify-center px-2.5 py-2">
          <button
            onClick={() => onRemove(course.id)}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100"
            aria-label="Remove"
          >
            <X className="h-3 w-3" />
          </button>

          <div
            onPointerDown={handlePointerDown}
            className="flex h-full cursor-grab select-none flex-col justify-center gap-0.5 pr-6 active:cursor-grabbing"
          >
            <p className="text-[10px] font-semibold uppercase leading-none tracking-wider text-muted-foreground mb-0.5">
              {course.code ?? course.type}
            </p>
            <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
              {course.title}
            </p>
            {course.credits && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {course.credits} cr
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
