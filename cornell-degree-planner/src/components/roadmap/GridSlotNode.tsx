import { useRef, useEffect, useSyncExternalStore } from "react";
import { X, CheckCircle, Circle, AlertTriangle } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import type { ProgramSlotWithData, Course, NodeStatus } from "@/types/db";
import { usePlannerStore } from "@/store/usePlannerStore";
import { CARD_W, CARD_H } from "@/lib/graph/buildRoadmapGrid";
import { dragState } from "@/lib/drag/dragState";

const statusStyles: Record<NodeStatus, string> = {
  completed: "border-complete bg-complete-tint",
  available: "border-available bg-available-tint",
  waived: "border-waived bg-waived-tint",
};

function getDisplay(slot: ProgramSlotWithData, selectedCourse: Course | null) {
  // User-placed course takes priority for all slot kinds
  if (selectedCourse) {
    const cr =
      selectedCourse.credits_min === selectedCourse.credits_max
        ? `${selectedCourse.credits_min} cr`
        : `${selectedCourse.credits_min}–${selectedCourse.credits_max} cr`;
    return {
      code: `${selectedCourse.subject} ${selectedCourse.number}`,
      title: selectedCourse.title,
      credits: cr,
    };
  }
  // Template default for fixed-course slots
  if (slot.kind === "course" && slot.courses) {
    const c = slot.courses;
    const cr =
      c.credits_min === c.credits_max
        ? `${c.credits_min} cr`
        : `${c.credits_min}–${c.credits_max} cr`;
    return { code: `${c.subject} ${c.number}`, title: c.title, credits: cr };
  }
  // Elective placeholder
  if (slot.kind === "elective" && slot.elective_groups) {
    return {
      code: "Elective",
      title: slot.elective_groups.name,
      credits: `${slot.elective_groups.min_credits} cr`,
    };
  }
  // Pattern placeholder
  if (slot.kind === "pattern") {
    return {
      code: slot.pattern ?? "???",
      title: slot.pattern_title ?? "Any matching course",
      credits: null,
    };
  }
  return { code: "—", title: "Unknown slot", credits: null };
}

type GridSlotData = { slot: ProgramSlotWithData };

export function GridSlotNode({
  data,
  prereqStatus,
}: {
  data: GridSlotData;
  prereqStatus: boolean | null;
}) {
  const { slot } = data;

  const isCompleted = usePlannerStore((s) => s.completedSlotIds.includes(slot.id));
  const isWaived = usePlannerStore((s) => s.waivedSlotIds.includes(slot.id));
  const slotSelections = usePlannerStore((s) => s.slotSelections);
  const selectedCourses = usePlannerStore((s) => s.selectedCourses);
  const toggleCompleted = usePlannerStore((s) => s.toggleCompleted);
  const clearSlot = usePlannerStore((s) => s.clearSlot);
  const status: NodeStatus = isCompleted ? "completed" : isWaived ? "waived" : "available";

  const selectedCourseId = slotSelections[slot.id] ?? null;
  const selectedCourse = selectedCourseId ? (selectedCourses[selectedCourseId] ?? null) : null;

  // Template default course (for course-kind slots with no user selection)
  const templateCourse = slot.kind === "course" ? slot.courses : null;
  // A slot has content if there's a user-placed course OR a template default
  const hasContent = selectedCourse !== null || templateCourse !== null;

  const cardRef = useRef<HTMLDivElement>(null);
  const prevSelected = useRef<string | null>(null);

  const isOver = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.overSlotId === slot.id
  );

  // Only user-placed courses are draggable out (not template defaults)
  const isDraggingSelected = useSyncExternalStore(
    dragState.subscribe,
    () =>
      dragState.get()?.courseId === selectedCourse?.id &&
      dragState.get()?.sourceSlotId === slot.id
  );

  // Spring entrance when an elective/pattern slot gets filled
  useEffect(() => {
    const wasEmpty = prevSelected.current === null;
    const isNowFilled = selectedCourse !== null;
    prevSelected.current = selectedCourse?.id ?? null;

    if (wasEmpty && isNowFilled && cardRef.current) {
      animate(cardRef.current, {
        scale: [0.65, 1.06, 1.0],
        opacity: [0, 1],
        ease: spring({ bounce: 0.4, duration: 480 }),
      });
    }
  }, [selectedCourse?.id]);

  // Hover lift
  useEffect(() => {
    if (!cardRef.current) return;
    const el = cardRef.current;
    const onEnter = () => {
      if (!dragState.get()) animate(el, { y: -4, duration: 140, ease: "out(2)" });
    };
    const onLeave = () => animate(el, { y: 0, duration: 180, ease: "out(2)" });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only drag user-placed courses (not template defaults)
    if (!selectedCourse || isDraggingSelected) return;
    e.preventDefault();
    e.stopPropagation();
    dragState.start({
      courseId: selectedCourse.id,
      course: selectedCourse,
      sourceSlotId: slot.id,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  const isEmpty = !hasContent || isDraggingSelected;
  const display = getDisplay(slot, isDraggingSelected ? null : selectedCourse);

  return (
    <div
      data-slot={slot.id}
      style={{ width: CARD_W, height: CARD_H }}
      className={cn(
        "rounded-lg border transition-colors",
        isEmpty
          ? isOver
            ? "border-solid border-drop bg-drop-tint"
            : "border-dashed border-line bg-transparent"
          : statusStyles[status]
      )}
    >
      {isEmpty && isOver ? (
        <div className="flex h-full items-center justify-center">
          <span className="t-body font-medium text-drop-text">Drop here</span>
        </div>
      ) : (
        <div
          ref={cardRef}
          className={cn("relative h-full", isEmpty && "opacity-40")}
        >
          {/* Buttons row */}
          <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
            {prereqStatus === false && !isDraggingSelected && (
              <span
                title="Prerequisite not met"
                className="flex items-center rounded p-0.5 text-available"
              >
                <AlertTriangle className="h-3 w-3" />
              </span>
            )}
            {prereqStatus === true && !isDraggingSelected && (
              <span
                title="Prerequisites met"
                className="mx-0.5 inline-block h-2 w-2 rounded-full bg-complete"
              />
            )}
            {selectedCourse && !isDraggingSelected && (
              <button
                onClick={() => clearSlot(slot.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded p-0.5 text-ink-3 opacity-60 hover:opacity-100"
                aria-label="Clear selection"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => toggleCompleted(slot.id)}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "rounded p-0.5 opacity-60 hover:opacity-100",
                status === "completed" ? "text-complete-text" : "text-ink-3"
              )}
              aria-label={status === "completed" ? "Mark incomplete" : "Mark complete"}
            >
              {status === "completed" ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
            </button>
          </div>

          {/* Content */}
          <div
            onPointerDown={handlePointerDown}
            className={cn(
              "flex h-full flex-col justify-center gap-0.5 px-2.5 py-2 pr-12",
              selectedCourse
                ? "cursor-grab select-none active:cursor-grabbing"
                : "cursor-default"
            )}
          >
            <p className="t-label">{display.code}</p>
            <p className="line-clamp-2 t-body">{display.title}</p>
            {display.credits && (
              <p className="t-meta">
                <span className="num">{display.credits}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
