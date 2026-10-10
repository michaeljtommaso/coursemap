import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  animate,
  createAnimatable,
  spring,
  type AnimatableObject,
  type JSAnimation,
} from "animejs";
import {
  dragState,
  measureLandedCard,
  type DropTarget,
  type OriginRect,
} from "@/lib/drag/dragState";
import { isNoopMove } from "@/lib/drag/insertion";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { prefersReducedMotion } from "@/lib/motion";
import type { Course } from "@/types/db";

// Ghost size = a board card at 100% (column w-[216px], card min-h 104px). The
// ghost lives in a body portal OUTSIDE the zoomed canvas, so it is scaled by
// the canvas zoom to match the cards at 55–100% (spec 014 §D3).
const CARD_W = 216;
const CARD_H = 104;

/** Snap spring with an explicit settle duration (July audit §6): bounded,
 *  predictable timing reads crisper than an open-ended spring. */
const SNAP_EASE = () => spring({ bounce: 0.25, duration: 320 });

/** Frames to wait for the committed card to render at its landing spot before
 *  falling back to the outline rect captured at drop() (fix pass D3). */
const LAND_MEASURE_FRAMES = 3;

/** Drop animations run on FIXED durations (fix pass D8/D9): a spring settles
 *  on a long sub-pixel tail, which held the session — and body.dragging-active
 *  — ~0.4–0.7s past the visible motion. A deadline timer ends the session
 *  just after the animation should have, even if onComplete never arrives. */
const LAND_MS = 260;
const HOME_MS = 320;
const END_GRACE_MS = 80;

type Session = { id: string; course: Course; phase: "dragging" | "dropping" };

type DropInfo = {
  sessionId: string;
  course: Course;
  sourcePlacementId: string | null;
  home: DropTarget | null;
  drop: DropTarget | null;
  dropRect: OriginRect;
  originRect: OriginRect;
  sourceEl: HTMLElement | null;
};

/**
 * DragGhost — the traveling card (spec 014 §D3/§D4).
 *  - Follows the cursor with zero latency (createAnimatable, never animate()
 *    per pointermove) and tilts with horizontal velocity.
 *  - While an insertion point is hovered, springs into the dashed placeholder
 *    outline SemesterColumn renders there (and follows it if the canvas
 *    auto-scrolls).
 *  - On drop it COMMITS synchronously, exactly once per drag SESSION (spec 009
 *    §5): a card drag → movePlacement(id, sem, index), a catalog drag →
 *    addPlacement(course, sem, index). A card dropped back on its own position
 *    is a no-op. Nothing is ever replaced. THEN it animates — decoration only;
 *    the animation's onComplete just ends the session.
 *  - Landing settles onto the committed card itself, measured once React has
 *    rendered it (fix pass D3); the outline rect from drop() is the fallback.
 *  - No target (outside the canvas, Esc, pointercancel) — or a catalog drop
 *    refused at the board cap: springs back home.
 */
export function DragGhost() {
  const { addPlacement, movePlacement } = usePlan();
  const zoom = usePlannerStore((s) => s.zoom);

  // Latest plan actions, read at drop time without re-running the drop effect
  // (which would replay its animation).
  const actionsRef = useRef({ addPlacement, movePlacement });
  useEffect(() => {
    actionsRef.current = { addPlacement, movePlacement };
  }, [addPlacement, movePlacement]);

  const ghostRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimatableObject | null>(null);
  const dropAnimRef = useRef<JSAnimation | null>(null);
  const dropInfoRef = useRef<DropInfo | null>(null);
  // The commit guard (sweep D3): keyed on the drag SESSION id, which dragState
  // mints fresh for every drag — the same card dragged twice commits twice.
  const committedSessionRef = useRef<string | null>(null);
  // What the commit landed (the moved placement, or the new one a catalog drop
  // added; null = nothing landed, e.g. refused at the cap) — the ghost settles
  // onto that card.
  const landedRef = useRef<{ sessionId: string; placementId: string | null } | null>(null);

  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    return dragState.subscribe(() => {
      const s = dragState.get();
      if (s?.phase === "dropping" && dropInfoRef.current?.sessionId !== s.sessionId) {
        dropInfoRef.current = {
          sessionId: s.sessionId,
          course: s.course,
          sourcePlacementId: s.sourcePlacementId,
          home: s.home,
          drop: s.drop,
          dropRect: s.dropRect,
          originRect: s.originRect,
          sourceEl: s.sourceEl,
        };
      }
      setSession((prev) => {
        if (!s) return null;
        if (prev && prev.id === s.sessionId && prev.phase === s.phase) return prev;
        return { id: s.sessionId, course: s.course, phase: s.phase };
      });
    });
  }, []);

  const sessionId = session?.id ?? null;
  const phase = session?.phase ?? null;

  // ── Cursor tracking + outline snapping for the active drag ──
  useEffect(() => {
    if (!sessionId || !ghostRef.current) return;
    const el = ghostRef.current;
    const s = dragState.get();
    if (!s || s.sessionId !== sessionId) return;

    // A previous drag's landing animation may still be running on this node.
    dropAnimRef.current?.cancel();
    dropAnimRef.current = null;

    const z = usePlannerStore.getState().zoom;
    const halfW = (CARD_W * z) / 2;
    const halfH = (CARD_H * z) / 2;
    let lastX = s.startX;
    let snappedKey: string | null = null;
    let snapAnim: JSAnimation | null = null;
    let springing = false;
    let lastSnap: { left: number; top: number } | null = null;
    let raf = 0;

    const anim = createAnimatable(el, {
      x: { duration: 0 },
      y: { duration: 0 },
      rotate: { duration: 160, ease: "out(2)" },
    });
    animRef.current = anim;
    anim.x(s.currentX - halfW);
    anim.y(s.currentY - halfH);
    animate(el, {
      scale: [0.82, 1.04, 1.0],
      opacity: [0, 1],
      duration: 280,
      ease: "out(3)",
    });

    // Measure the placeholder outline (rendered by SemesterColumn after the
    // `over` change commits — hence rAF) and spring / pin the ghost into it.
    const snapToOutline = (fresh: boolean) => {
      const ds = dragState.get();
      if (!ds || ds.sessionId !== sessionId || ds.phase !== "dragging" || !ds.over) return;
      const outline = document.querySelector<HTMLElement>("[data-drop-outline]");
      if (!outline) return;
      const r = outline.getBoundingClientRect();
      if (fresh) {
        springing = true;
        lastSnap = { left: r.left, top: r.top };
        snapAnim?.cancel();
        snapAnim = animate(el, {
          x: r.left,
          y: r.top,
          rotate: 0,
          ease: SNAP_EASE(),
          onComplete() {
            springing = false;
          },
        });
        return;
      }
      // Same target, but the outline moved (edge auto-scroll): pin to it.
      if (springing || !lastSnap) return;
      if (Math.abs(r.left - lastSnap.left) < 1 && Math.abs(r.top - lastSnap.top) < 1) return;
      lastSnap = { left: r.left, top: r.top };
      anim.x(r.left);
      anim.y(r.top);
    };

    const unsub = dragState.subscribeToPosition(() => {
      const ds = dragState.get();
      if (!ds || ds.sessionId !== sessionId || ds.phase !== "dragging") return;

      if (ds.over) {
        const key = `${ds.over.sem}:${ds.over.index}`;
        const fresh = key !== snappedKey;
        snappedKey = key;
        lastX = ds.currentX;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => snapToOutline(fresh));
        return;
      }

      // Free flight: follow the cursor, tilt with horizontal velocity.
      if (snappedKey) {
        snappedKey = null;
        lastSnap = null;
        springing = false;
        snapAnim?.cancel();
        snapAnim = null;
        cancelAnimationFrame(raf);
      }
      const dx = ds.currentX - lastX;
      lastX = ds.currentX;
      anim.rotate(Math.max(-10, Math.min(10, dx * 0.45)));
      anim.x(ds.currentX - halfW);
      anim.y(ds.currentY - halfH);
    });

    return () => {
      unsub();
      cancelAnimationFrame(raf);
      snapAnim?.cancel();
    };
  }, [sessionId]);

  // ── Drop: COMMIT synchronously (spec 009 §5), THEN animate as decoration ──
  // State is never gated on an animation callback — an interrupted animation
  // can't lose a placement. dragState's fallback timer ends the session even if
  // onComplete never arrives.
  useEffect(() => {
    if (!sessionId || phase !== "dropping") return;
    const info = dropInfoRef.current;
    if (!info || info.sessionId !== sessionId) return;

    // ── Commit (once per session) ──
    if (committedSessionRef.current !== sessionId) {
      committedSessionRef.current = sessionId;
      const target = info.drop;
      let landedId: string | null = null;
      if (target) {
        const { addPlacement: add, movePlacement: move } = actionsRef.current;
        if (info.sourcePlacementId) {
          if (!isNoopMove(info.home, target)) {
            move(info.sourcePlacementId, target.sem, target.index);
          }
          landedId = info.sourcePlacementId;
        } else {
          // null = refused at the cap (with a toast) — nothing landed.
          landedId = add(info.course, target.sem, target.index);
        }
      }
      landedRef.current = { sessionId, placementId: landedId };
    }

    const el = ghostRef.current;
    const finish = () => dragState.end(sessionId);
    if (!el) {
      finish();
      return;
    }
    // Deadline (fix pass D8/D9): end the session just after the longest drop
    // animation (incl. the landing-measure frames) could take, whether or not
    // its onComplete arrives — well inside dragState's 1.2s fallback.
    let raf = 0;
    const deadline = setTimeout(
      finish,
      LAND_MEASURE_FRAMES * 17 + Math.max(LAND_MS, HOME_MS) + END_GRACE_MS
    );
    const cleanup = () => {
      cancelAnimationFrame(raf);
      clearTimeout(deadline);
    };
    const z = usePlannerStore.getState().zoom;
    const ghostW = CARD_W * z;
    const reduced = prefersReducedMotion();
    const landed =
      landedRef.current?.sessionId === sessionId ? landedRef.current.placementId : null;

    // ── Landed: settle onto the committed card (fix pass D3). The outline rect
    //    captured at drop() can be one render behind on a fast flick (the
    //    release-point target never rendered its outline), so measure the card
    //    itself once React has rendered the commit — retried for a few frames,
    //    falling back to the outline rect. ──
    const target = info.drop;
    if (target && landed) {
      if (reduced) {
        dropAnimRef.current = animate(el, {
          opacity: 0,
          duration: 120,
          ease: "out(3)",
          onComplete: finish,
        });
        return cleanup;
      }
      let tries = 0;
      const settle = () => {
        const measured = measureLandedCard(landed, target);
        if (!measured && tries < LAND_MEASURE_FRAMES) {
          tries += 1;
          raf = requestAnimationFrame(settle);
          return;
        }
        const r = measured ?? info.dropRect;
        dropAnimRef.current = r
          ? animate(el, {
              x: r.left,
              y: r.top,
              rotate: 0,
              opacity: [1, 0],
              duration: LAND_MS,
              ease: "out(3)",
              onComplete: finish,
            })
          : animate(el, {
              opacity: 0,
              duration: 200,
              ease: "out(3)",
              onComplete: finish,
            });
      };
      raf = requestAnimationFrame(settle);
      return cleanup;
    }

    // ── No target (spec 006 §F1): spring back HOME. The source is re-measured
    //    at drop time (the canvas may have scrolled mid-drag); originRect is the
    //    fallback for a source that left the DOM or is hidden. ──
    const live =
      info.sourceEl && info.sourceEl.isConnected ? info.sourceEl.getBoundingClientRect() : null;
    const homeRect = live && live.width > 0 ? live : info.originRect;
    if (homeRect && !reduced) {
      dropAnimRef.current = animate(el, {
        x: homeRect.left,
        y: homeRect.top,
        rotate: 0,
        // The ghost already matches the canvas zoom; shrink/grow into the
        // source (a catalog row is narrower than a card).
        scale: homeRect.width / ghostW,
        opacity: [1, 0],
        duration: HOME_MS,
        ease: "out(3)",
        onComplete: finish,
      });
      return cleanup;
    }
    dropAnimRef.current = animate(el, {
      scale: reduced ? 1 : 0.65,
      opacity: 0,
      duration: reduced ? 150 : 230,
      ease: "out(3)",
      onComplete: finish,
    });
    return cleanup;
  }, [sessionId, phase]);

  if (!session) return null;

  const course = session.course;
  const label = `${course.subject} ${course.number}`;
  const credits =
    course.credits_min === course.credits_max
      ? `${course.credits_min} cr`
      : `${course.credits_min}–${course.credits_max} cr`;

  return createPortal(
    <div
      ref={ghostRef}
      data-drag-ghost
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: CARD_W * zoom,
        height: CARD_H * zoom,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: 0,
        willChange: "transform, opacity",
      }}
    >
      {/* Card-sized body scaled to the canvas zoom (top-left origin, so the
          outer box — which anime.js moves/tilts — is exactly the zoomed size). */}
      <div
        className="rounded-lg border-2 border-drop bg-drop-tint shadow-xl"
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div className="flex h-full flex-col justify-center gap-0.5 px-2.5 py-2">
          <p className="t-label text-drop-text">{label}</p>
          <p className="line-clamp-2 t-body">{course.title}</p>
          <p className="mt-0.5 t-meta">
            <span className="num">{credits}</span>
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
