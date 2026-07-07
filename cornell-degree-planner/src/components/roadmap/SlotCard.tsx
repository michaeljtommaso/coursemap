import { useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { X, Check, AlertTriangle, Undo2, Minus } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import type { ProgramSlotWithData, Course, NodeStatus } from "@/types/db";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { dragState } from "@/lib/drag/dragState";
import { slotCredits, formatCredits } from "@/lib/planner/semesters";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * SlotCard — the signature component of the roadmap (spec 004 §2).
 *
 * Anatomy, top → bottom:
 *   1. Status rail: 3px full-width strip in the status base color. Reads at a
 *      glance across the whole grid; absent on empty slots.
 *   2. Eyebrow row: the slot's IDENTITY — a fixed course's code, or the bucket/
 *      pattern name. A filled bucket KEEPS its bucket identity here while the
 *      chosen course takes the title line (never lose the bucket context).
 *      Credits sit right-aligned in mono.
 *   3. Title: the read-first element (students recognize titles, not codes).
 *   4. Action row: revealed on hover/focus-within (always visible on touch):
 *      Complete / Waive / Clear. Real buttons, keyboard reachable.
 *
 * Interactions: drag out (user-placed courses, 6px threshold), click-to-arm
 * for the move flow, click-to-place when a course is armed and this slot can
 * accept it, chain highlighting via onChainHover.
 */

const statusStyles: Record<NodeStatus, string> = {
  completed: "border-complete/60 bg-complete-tint",
  available: "border-line bg-surface",
  waived: "border-waived/60 bg-waived-tint",
};

const railStyles: Record<NodeStatus, string> = {
  completed: "bg-complete",
  available: "bg-transparent",
  waived: "bg-waived",
};

type Display = {
  eyebrow: string;
  title: string;
  metaCode: string | null; // shown when a bucket is filled ("CS 3780")
  credits: string | null;
};

function getDisplay(slot: ProgramSlotWithData, placed: Course | null): Display {
  const credits = formatCredits(slotCredits(slot, placed));
  if (placed) {
    // A filled bucket/pattern keeps its identity as the eyebrow (spec 004 §2 +
    // the overnight brief); a fixed-course replacement shows the new code.
    const eyebrow =
      slot.kind === "elective" && slot.elective_groups
        ? slot.elective_groups.name
        : slot.kind === "pattern"
          ? (slot.pattern_title ?? slot.pattern ?? "Pattern")
          : `${placed.subject} ${placed.number}`;
    const metaCode =
      slot.kind === "course" ? null : `${placed.subject} ${placed.number}`;
    return { eyebrow, title: placed.title, metaCode, credits };
  }
  if (slot.kind === "course" && slot.courses) {
    const c = slot.courses;
    return { eyebrow: `${c.subject} ${c.number}`, title: c.title, metaCode: null, credits };
  }
  if (slot.kind === "elective" && slot.elective_groups) {
    return { eyebrow: "Elective", title: slot.elective_groups.name, metaCode: null, credits };
  }
  if (slot.kind === "pattern") {
    return {
      eyebrow: slot.pattern ?? "Pattern",
      title: slot.pattern_title ?? "Any matching course",
      metaCode: null,
      credits,
    };
  }
  return { eyebrow: "—", title: "Unknown slot", metaCode: null, credits };
}

export function SlotCard({
  slot,
  prereqStatus,
  registerRef,
  onChainHover,
  onCompleted,
}: {
  slot: ProgramSlotWithData;
  prereqStatus: boolean | null;
  /** EdgeLayer measures cards through this registry. */
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  /** Chain highlighting: hover/focus enters, null leaves. */
  onChainHover: (slotId: string | null) => void;
  /** Completion pulse hook for the edge layer. */
  onCompleted: (slotId: string) => void;
}) {
  const {
    completedSlotIds,
    waivedSlotIds,
    slotSelections,
    selectedCourses,
    toggleCompleted,
    toggleWaived,
    clearSlot,
    assignSlot,
  } = usePlan();

  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const armedSourceSlotId = usePlannerStore((s) => s.armedSourceSlotId);
  const armCourse = usePlannerStore((s) => s.armCourse);
  const disarm = usePlannerStore((s) => s.disarm);

  const isCompleted = completedSlotIds.includes(slot.id);
  const isWaived = waivedSlotIds.includes(slot.id);
  const status: NodeStatus = isCompleted ? "completed" : isWaived ? "waived" : "available";

  const selectedCourseId = slotSelections[slot.id] ?? null;
  const placed = selectedCourseId ? (selectedCourses[selectedCourseId] ?? null) : null;
  const templateCourse = slot.kind === "course" ? slot.courses : null;
  const hasContent = placed !== null || templateCourse !== null;

  const outerRef = useRef<HTMLDivElement>(null);
  const prevPlaced = useRef<string | null>(placed?.id ?? null);
  const dragCandidate = useRef<{ x: number; y: number } | null>(null);

  const isDraggingOut = useSyncExternalStore(
    dragState.subscribe,
    () =>
      dragState.get()?.courseId === placed?.id &&
      dragState.get()?.sourceSlotId === slot.id
  );
  const isDropTarget = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.overSlotId === slot.id
  );

  // A slot can receive the armed course unless a DIFFERENT course occupies it.
  const canReceiveArmed =
    armedCourse !== null &&
    armedSourceSlotId !== slot.id &&
    (!selectedCourseId || selectedCourseId === armedCourse.id);

  useEffect(() => {
    registerRef(slot.id, outerRef.current);
    return () => registerRef(slot.id, null);
  }, [slot.id, registerRef]);

  // Spring entrance on fill (DESIGN.md's one sanctioned bounce), cancel-safe.
  useEffect(() => {
    const wasEmpty = prevPlaced.current === null;
    prevPlaced.current = placed?.id ?? null;
    if (wasEmpty && placed && outerRef.current && !prefersReducedMotion()) {
      const anim = animate(outerRef.current, {
        scale: [0.7, 1.04, 1.0],
        opacity: [0.4, 1],
        ease: spring({ bounce: 0.4, duration: 480 }),
      });
      return () => {
        anim.cancel();
      };
    }
  }, [placed?.id]);

  // Hover lift — suppressed during drag and reduced-motion; cancel on unmount.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    let live: ReturnType<typeof animate> | null = null;
    const onEnter = () => {
      if (dragState.get() || prefersReducedMotion()) return;
      live = animate(el, { y: -3, duration: 140, ease: "out(2)" });
    };
    const onLeave = () => {
      if (prefersReducedMotion()) return;
      live = animate(el, { y: 0, duration: 180, ease: "out(2)" });
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      live?.cancel();
    };
  }, []);

  // Drag-out with a 6px movement threshold (spec 004 §4) — a plain click on a
  // user-placed course ARMS it for the move flow instead of starting a drag.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!placed || isDraggingOut) return;
    dragCandidate.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragCandidate.current;
    if (!start || !placed) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      dragCandidate.current = null;
      disarm();
      dragState.start({
        courseId: placed.id,
        course: placed,
        sourceSlotId: slot.id,
        startX: e.clientX,
        startY: e.clientY,
      });
    }
  };
  const onPointerUp = () => {
    dragCandidate.current = null;
  };

  const handleClick = () => {
    // Place the armed course here.
    if (armedCourse && canReceiveArmed) {
      assignSlot(slot.id, armedCourse);
      disarm();
      return;
    }
    // Arm a user-placed course for moving (click = pick up, click = put down).
    if (placed && !armedCourse) {
      armCourse(placed, slot.id);
      return;
    }
    if (armedCourse) disarm();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const handleToggleCompleted = useCallback(() => {
    const wasCompleted = completedSlotIds.includes(slot.id);
    toggleCompleted(slot.id);
    if (!wasCompleted) onCompleted(slot.id); // edge pulse (spec 004 brief)
  }, [completedSlotIds, slot.id, toggleCompleted, onCompleted]);

  const isArmedSource = armedSourceSlotId === slot.id && armedCourse !== null;
  const display = getDisplay(slot, isDraggingOut || isArmedSource ? null : placed);
  const showAsEmpty = (!hasContent && !isDropTarget) || isDraggingOut || isArmedSource;
  const highlightForArm = armedCourse !== null && canReceiveArmed;

  const ariaLabel = placed
    ? `${display.metaCode ?? display.eyebrow} ${display.title}${isCompleted ? ", completed" : ""}. Press Enter to pick up.`
    : hasContent
      ? `${display.eyebrow} ${display.title}${isCompleted ? ", completed" : ""}`
      : `${display.title}, open slot${armedCourse ? `. Press Enter to place ${armedCourse.subject} ${armedCourse.number}.` : ""}`;

  return (
    <div
      ref={outerRef}
      data-slot={slot.id}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={() => onChainHover(slot.id)}
      onMouseLeave={() => onChainHover(null)}
      onFocus={() => onChainHover(slot.id)}
      onBlur={() => onChainHover(null)}
      className={cn(
        "group relative flex min-h-[84px] w-full flex-col overflow-hidden rounded-lg border text-left outline-none transition-[border-color,background-color,box-shadow]",
        "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        showAsEmpty
          ? cn(
              "border-dashed border-line bg-transparent",
              highlightForArm && "border-solid border-drop bg-drop-tint/60 cursor-pointer"
            )
          : cn(
              statusStyles[status],
              placed && "cursor-grab active:cursor-grabbing",
              highlightForArm && "border-drop ring-1 ring-drop cursor-pointer"
            ),
        isDropTarget && "border-solid border-drop bg-drop-tint"
      )}
    >
      {/* 1. Status rail */}
      {!showAsEmpty && (
        <div className={cn("h-[3px] w-full shrink-0", railStyles[status])} aria-hidden="true" />
      )}

      {isDropTarget && showAsEmpty ? (
        <div className="flex flex-1 items-center justify-center py-4">
          <span className="t-body font-medium text-drop-text">Drop it here</span>
        </div>
      ) : showAsEmpty ? (
        /* Empty slot — keeps the bucket identity visible, quiet invite on arm */
        <div className={cn("flex flex-1 flex-col justify-center gap-0.5 px-2.5 py-2", highlightForArm ? "opacity-90" : "opacity-45")}>
          <div className="flex items-baseline justify-between gap-1.5">
            <p className="t-label truncate">{display.eyebrow}</p>
            {display.credits && (
              <p className="t-meta shrink-0"><span className="num">{display.credits} cr</span></p>
            )}
          </div>
          <p className="line-clamp-2 t-body text-ink-2">{display.title}</p>
          {highlightForArm && armedCourse && (
            <p className="t-meta text-drop-text">
              Place {armedCourse.subject} {armedCourse.number} here
            </p>
          )}
        </div>
      ) : (
        <>
          {/* 2+3. Eyebrow + title */}
          <div className="flex flex-1 flex-col gap-0.5 px-2.5 pb-1.5 pt-1.5">
            <div className="flex items-baseline justify-between gap-1.5">
              <p className="t-label truncate">{display.eyebrow}</p>
              <span className="flex shrink-0 items-center gap-1">
                {prereqStatus === false && (
                  <AlertTriangle
                    className="h-3 w-3 text-available"
                    aria-label="Usually needs an earlier course first"
                  />
                )}
                {prereqStatus === true && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-complete"
                    aria-label="Prerequisites covered"
                  />
                )}
                {display.credits && (
                  <span className="t-meta"><span className="num">{display.credits} cr</span></span>
                )}
              </span>
            </div>
            <p className={cn("line-clamp-3 t-body font-semibold", isCompleted && "text-complete-text")}>
              {display.title}
            </p>
            {display.metaCode && <p className="t-meta">{display.metaCode}</p>}
            {isWaived && <p className="t-meta text-waived-text">Waived</p>}
          </div>

          {/* 4. Action row — hover/focus reveal; always shown on touch */}
          <div
            className={cn(
              "flex items-center gap-0.5 border-t border-line/60 px-1.5 py-1",
              "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
              "[@media(hover:none)]:opacity-100"
            )}
          >
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleCompleted(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 t-label transition-colors",
                isCompleted
                  ? "text-complete-text hover:bg-complete/15"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              )}
              aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
            >
              <Check className="h-3 w-3" />
              {isCompleted ? "Done" : "Complete"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleWaived(slot.id); }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 t-label transition-colors",
                isWaived
                  ? "text-waived-text hover:bg-waived/15"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              )}
              aria-label={isWaived ? "Remove waiver" : "Mark waived"}
            >
              {isWaived ? <Undo2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {isWaived ? "Unwaive" : "Waive"}
            </button>
            {placed && (
              <button
                onClick={(e) => { e.stopPropagation(); disarm(); clearSlot(slot.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="ml-auto inline-flex items-center rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="Remove this course from the slot"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
