import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { animate, createAnimatable, spring, type AnimatableObject } from "animejs";
import { dragState, type DragMode, type OriginRect } from "@/lib/drag/dragState";
import { usePlan } from "@/hooks/usePlan";
import { prefersReducedMotion } from "@/lib/motion";
import type { Course } from "@/types/db";

// Ghost card size — visual only (slot cards themselves flex to content).
const CARD_W = 200;
const CARD_H = 84;

/**
 * DragGhost — the traveling card. Two modes (spec 005 §9):
 *  - course: shows the course; drop on slot = place, drop on column = re-home
 *    into a new custom slot in that semester.
 *  - slot: shows the slot identity; drop on column = move the slot there.
 */
export function DragGhost() {
  const { assignSlot, moveSlot, addCustomSlot } = usePlan();

  const ghostRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimatableObject | null>(null);
  const lastXRef = useRef(0);
  const snappedSlotRef = useRef<string | null>(null);

  const dropInfoRef = useRef<{
    mode: DragMode;
    targetSlotId: string | null;
    targetColumnSem: number | null;
    course: Course | null;
    slotId: string | null;
    originRect: OriginRect;
    sourceEl: HTMLElement | null;
  } | null>(null);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [displayCourse, setDisplayCourse] = useState<Course | null>(null);
  const [slotLabel, setSlotLabel] = useState<{ eyebrow: string; title: string } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    return dragState.subscribe(() => {
      const s = dragState.get();
      setDragKey(s?.dragKey ?? null);
      setDisplayCourse(s?.course ?? null);
      setSlotLabel(s?.slotLabel ?? null);
      setPhase(s?.phase ?? null);
      if (s?.phase === "dropping") {
        dropInfoRef.current = {
          mode: s.mode,
          targetSlotId: s.dropTargetId,
          targetColumnSem: s.dropColumnSem,
          course: s.course,
          slotId: s.sourceSlotId,
          originRect: s.originRect,
          sourceEl: s.sourceEl,
        };
      }
    });
  }, []);

  // Cursor tracking for the active drag.
  useEffect(() => {
    if (!dragKey || !ghostRef.current) return;
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

      // Snap to slot (course mode only — slots don't accept slots).
      if (ds.overSlotId && ds.overSlotId !== snappedSlotRef.current) {
        snappedSlotRef.current = ds.overSlotId;
        const slotEl = document.querySelector(`[data-slot="${ds.overSlotId}"]`);
        if (slotEl && ghostRef.current) {
          const rect = slotEl.getBoundingClientRect();
          animate(ghostRef.current, {
            x: rect.left,
            y: rect.top,
            rotate: 0,
            ease: spring({ bounce: 0.25 }),
          });
        }
        return;
      }

      if (!ds.overSlotId && snappedSlotRef.current) {
        snappedSlotRef.current = null;
      }
      if (ds.overSlotId) return;

      animRef.current.x(ds.currentX - halfW);
      animRef.current.y(ds.currentY - halfH);
    });

    return unsub;
  }, [dragKey]);

  // Drop animation + the actual mutation.
  useEffect(() => {
    if (!ghostRef.current || !dropInfoRef.current || phase !== "dropping") return;
    const el = ghostRef.current;
    const { mode, targetSlotId, targetColumnSem, course, slotId, originRect, sourceEl } =
      dropInfoRef.current;

    // course → slot: snap in (the classic).
    if (mode === "course" && targetSlotId && course) {
      const slotEl = document.querySelector(`[data-slot="${targetSlotId}"]`);
      if (slotEl) {
        const rect = slotEl.getBoundingClientRect();
        animate(el, {
          x: rect.left,
          y: rect.top,
          scale: [1, 0.88],
          opacity: [1, 0],
          ease: spring({ bounce: 0.08 }),
          onComplete() {
            assignSlot(targetSlotId, course);
            dragState.end();
          },
        });
        return;
      }
    }

    // course → column background: re-home into a new custom slot there.
    if (mode === "course" && targetColumnSem != null && course) {
      animate(el, {
        scale: 0.8,
        opacity: 0,
        duration: 240,
        ease: "out(3)",
        onComplete() {
          const newSlotId = addCustomSlot(targetColumnSem);
          assignSlot(newSlotId, course);
          dragState.end();
        },
      });
      return;
    }

    // slot → column background: the slot moves.
    if (mode === "slot" && targetColumnSem != null && slotId) {
      animate(el, {
        scale: 0.8,
        opacity: 0,
        duration: 240,
        ease: "out(3)",
        onComplete() {
          moveSlot(slotId, targetColumnSem);
          dragState.end();
        },
      });
      return;
    }

    // No valid target (spec 006 §F1): spring the card back HOME to where the
    // drag began, so a mis-drop reads as "returned" rather than "vanished."
    // The source element is RE-measured at drop time — the canvas may have
    // scrolled mid-drag (wheel or edge auto-scroll), so the rect captured at
    // drag start can be stale; the stored originRect is only the fallback for
    // a source that left the DOM (e.g. drawer closed mid-drag). Fallbacks: no
    // origin at all → the old quiet vanish; reduced motion → opacity-only fade.
    const homeRect =
      sourceEl && sourceEl.isConnected ? sourceEl.getBoundingClientRect() : originRect;
    if (homeRect) {
      if (prefersReducedMotion()) {
        animate(el, {
          opacity: [1, 0],
          duration: 150,
          ease: "out(2)",
          onComplete() {
            dragState.end();
          },
        });
        return;
      }
      animate(el, {
        x: homeRect.left,
        y: homeRect.top,
        // A zoomed-out origin is smaller than the fixed-size ghost; shrink
        // into it so the return reads as landing in the actual card.
        scale: homeRect.width / CARD_W,
        opacity: [1, 0],
        ease: spring({ bounce: 0.18 }),
        onComplete() {
          dragState.end();
        },
      });
      return;
    }

    // No origin — vanish quietly (unchanged fallback).
    animate(el, {
      scale: 0.65,
      opacity: 0,
      duration: 230,
      ease: "out(3)",
      onComplete() {
        dragState.end();
      },
    });
  }, [phase, assignSlot, moveSlot, addCustomSlot]);

  if (!dragKey || (!displayCourse && !slotLabel)) return null;

  const isSlotMode = !displayCourse && slotLabel;
  const label = displayCourse
    ? `${displayCourse.subject} ${displayCourse.number}`
    : slotLabel!.eyebrow;
  const title = displayCourse ? displayCourse.title : slotLabel!.title;
  const credits =
    displayCourse &&
    (displayCourse.credits_min === displayCourse.credits_max
      ? `${displayCourse.credits_min} cr`
      : `${displayCourse.credits_min}–${displayCourse.credits_max} cr`);

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
      className={
        isSlotMode
          ? "rounded-lg border-2 border-dashed border-ink-3 bg-surface shadow-xl"
          : "rounded-lg border-2 border-drop bg-drop-tint shadow-xl"
      }
    >
      <div className="flex h-full flex-col justify-center gap-0.5 px-2.5 py-2">
        <p className={isSlotMode ? "t-label" : "t-label text-drop-text"}>{label}</p>
        <p className="line-clamp-2 t-body">{title}</p>
        {credits && (
          <p className="mt-0.5 t-meta">
            <span className="num">{credits}</span>
          </p>
        )}
        {isSlotMode && <p className="t-meta text-ink-3">Drop on a semester</p>}
      </div>
    </div>,
    document.body
  );
}
