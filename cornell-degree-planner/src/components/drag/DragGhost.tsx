import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { animate, createAnimatable, spring, type AnimatableObject } from "animejs";
import { dragState } from "@/lib/drag/dragState";
import { usePlannerStore } from "@/store/usePlannerStore";
import { CARD_W, CARD_H } from "@/lib/graph/buildRoadmapGrid";
import type { Course } from "@/types/db";

export function DragGhost() {
  const assignSlot = usePlannerStore((s) => s.assignSlot);

  const ghostRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimatableObject | null>(null);
  const lastXRef = useRef(0);
  const snappedSlotRef = useRef<string | null>(null);

  const dropInfoRef = useRef<{
    targetId: string | null;
    course: Course | null;
  } | null>(null);

  const [courseId, setCourseId] = useState<string | null>(null);
  const [displayCourse, setDisplayCourse] = useState<Course | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    return dragState.subscribe(() => {
      const s = dragState.get();
      setCourseId(s?.courseId ?? null);
      setDisplayCourse(s?.course ?? null);
      setPhase(s?.phase ?? null);
      if (s?.phase === "dropping") {
        dropInfoRef.current = {
          targetId: s.dropTargetId,
          course: s.course,
        };
      }
    });
  }, []);

  // Set up cursor tracking when a new drag starts
  useEffect(() => {
    if (!courseId || !ghostRef.current) return;
    const el = ghostRef.current;
    const s = dragState.get();
    if (!s) return;

    const halfW = CARD_W / 2;
    const halfH = CARD_H / 2;
    lastXRef.current = s.startX;
    snappedSlotRef.current = null;

    const anim = createAnimatable(el, {
      x: { duration: 0 },
      y: { duration: 0 },
      rotate: { duration: 160, ease: "out(2)" },
    });
    animRef.current = anim;

    anim.x(s.startX - halfW);
    anim.y(s.startY - halfH);

    animate(el, {
      scale: [0.82, 1.04, 1.0],
      opacity: [0, 1],
      duration: 280,
      ease: "out(3)",
    });

    const unsub = dragState.subscribeToPosition(() => {
      const ds = dragState.get();
      if (!ds || ds.phase !== "dragging" || !animRef.current) return;

      const dx = ds.currentX - lastXRef.current;
      lastXRef.current = ds.currentX;
      animRef.current.rotate(Math.max(-10, Math.min(10, dx * 0.45)));

      // Snap to slot when hovering over a valid drop target
      if (ds.overSlotId && ds.overSlotId !== snappedSlotRef.current) {
        snappedSlotRef.current = ds.overSlotId;
        const slotEl = document.querySelector(`[data-slot="${ds.overSlotId}"]`);
        if (slotEl && ghostRef.current) {
          const rect = slotEl.getBoundingClientRect();
          animate(ghostRef.current, {
            x: rect.left,
            y: rect.top,
            rotate: 0,
            ease: spring({ bounce: 0.25, duration: 320 }),
          });
        }
        return;
      }

      // Left slot — resume cursor following immediately
      if (!ds.overSlotId && snappedSlotRef.current) {
        snappedSlotRef.current = null;
      }

      // Stay snapped while still over the same slot
      if (ds.overSlotId) return;

      // Normal cursor tracking
      animRef.current.x(ds.currentX - halfW);
      animRef.current.y(ds.currentY - halfH);
    });

    return unsub;
  }, [courseId]);

  // Drop animation
  useEffect(() => {
    if (!ghostRef.current || !dropInfoRef.current) return;
    const el = ghostRef.current;

    if (phase === "dropping") {
      const { targetId, course } = dropInfoRef.current;

      if (targetId) {
        const slotEl = document.querySelector(`[data-slot="${targetId}"]`);
        if (slotEl) {
          const rect = slotEl.getBoundingClientRect();
          animate(el, {
            x: rect.left,
            y: rect.top,
            scale: [1, 0.88],
            opacity: [1, 0],
            ease: spring({ bounce: 0.08, duration: 380 }),
            onComplete() {
              if (course) assignSlot(targetId, course);
              dragState.end();
            },
          });
          return;
        }
      }

      // No valid target — snap back and vanish
      animate(el, {
        scale: 0.65,
        opacity: 0,
        duration: 230,
        ease: "out(3)",
        onComplete() {
          dragState.end();
        },
      });
    }
  }, [phase, assignSlot]);

  if (!courseId || !displayCourse) return null;

  const label = `${displayCourse.subject} ${displayCourse.number}`;
  const credits =
    displayCourse.credits_min === displayCourse.credits_max
      ? `${displayCourse.credits_min} cr`
      : `${displayCourse.credits_min}–${displayCourse.credits_max} cr`;

  return createPortal(
    <div
      ref={ghostRef}
      data-drag-ghost
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: CARD_W,
        height: CARD_H,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: 0,
        willChange: "transform, opacity",
      }}
      className="rounded-lg border-2 border-blue-400 bg-blue-50 shadow-2xl dark:bg-blue-950"
    >
      <div className="flex h-full flex-col justify-center gap-0.5 px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase leading-none tracking-wider text-blue-600 dark:text-blue-400">
          {label}
        </p>
        <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
          {displayCourse.title}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{credits}</p>
      </div>
    </div>,
    document.body
  );
}
