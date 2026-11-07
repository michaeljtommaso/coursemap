import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTourStore } from "@/store/useTourStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useTopBarStore } from "@/store/useTopBarStore";
import { usePrograms } from "@/hooks/usePrograms";
import {
  TOUR_OWED,
  TOUR_READY,
  TOUR_SETTLE,
  TOUR_SEEN,
  classesSteps,
  plannerSteps,
  requirementsSteps,
  tourPathFor,
  type TourId,
  type TourStep,
} from "./tourSteps";

/**
 * TourOverlay (spec 033) — the planner's first-run tour. Dims the page,
 * cuts a rounded hole around the step's target, and places a card beside it.
 * The page underneath takes no clicks while the tour is open: Next / Back /
 * Skip on the card, arrow keys, and Esc are the only controls.
 */

const PAD = 8; // spotlight padding around the target
const EASE = "cubic-bezier(.16,1,.3,1)";
/** Between steps the hole slides across (and matches its width) first, then
 *  grows or shrinks to the new height, rather than doing both at once. */
const STAGED = `left 320ms ${EASE}, width 320ms ${EASE}, top 300ms ${EASE} 240ms, height 300ms ${EASE} 240ms`;
/** Within a step (drawer sliding, canvas scrolling) it just follows. */
const FOLLOW = "left 300ms ease-out, top 300ms ease-out, width 300ms ease-out, height 300ms ease-out";
const GAP = 14; // between the spotlight and the card
const CARD_W = 340;
const EDGE = 16; // keep the card this far from the viewport edge

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Union of the rects of every selector that matches (first match each). */
function measure(selectors: string[]): Box | null {
  const rects = selectors
    .map((s) => document.querySelector(s))
    .filter((el): el is Element => !!el)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  // Clamp to the viewport: a target taller than the screen (the board) still
  // reads as a framed region rather than running off the edges.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.max(left - PAD, 4);
  const y = Math.max(top - PAD, 4);
  return {
    x,
    y,
    w: Math.min(right + PAD, vw - 4) - x,
    h: Math.min(bottom + PAD, vh - 4) - y,
  };
}

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/** Card position: right of the spotlight, else left, below, above; clamped. */
function placeCard(box: Box | null, cardH: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!box) return { left: (vw - CARD_W) / 2, top: Math.max(EDGE, (vh - cardH) / 2) };
  const clampY = (t: number) => Math.min(Math.max(t, EDGE), vh - cardH - EDGE);
  const clampX = (l: number) => Math.min(Math.max(l, EDGE), vw - CARD_W - EDGE);
  if (box.x + box.w + GAP + CARD_W + EDGE <= vw)
    return { left: box.x + box.w + GAP, top: clampY(box.y) };
  if (box.x - GAP - CARD_W - EDGE >= 0)
    return { left: box.x - GAP - CARD_W, top: clampY(box.y) };
  if (box.y + box.h + GAP + cardH + EDGE <= vh)
    return { left: clampX(box.x), top: box.y + box.h + GAP };
  if (box.y - GAP - cardH - EDGE >= 0) return { left: clampX(box.x), top: box.y - GAP - cardH };
  // Target fills the screen (the board): float the card inside it, bottom-right.
  return { left: vw - CARD_W - EDGE * 2, top: vh - cardH - EDGE * 2 };
}

/** Automated browsers (the e2e suite) don't get tours started on them, so a
 *  test's clicks never land on the overlay; a test opts in with the
 *  `coursemap.e2eTours` localStorage key. */
function autoStartAllowed(): boolean {
  if (!navigator.webdriver) return true;
  try {
    return localStorage.getItem("coursemap.e2eTours") === "1";
  } catch {
    return false;
  }
}

/** The selectors a step actually spotlights: its targets, else its fallback. */
function targetsOf(step: TourStep | undefined): string[] | null {
  if (!step?.target) return null;
  if (measure(step.target) || !step.fallback) return step.target;
  return step.fallback;
}

/** One page's tour: starts itself while it's owed (first run just finished,
 *  this page not toured yet), and records it as seen when finished or skipped.
 *  Students from before the tours shipped are never owed one. */
export function TourOverlay({ tour }: { tour: TourId }) {
  const running = useTourStore((s) => s.tour);
  const start = useTourStore((s) => s.start);
  const closeStore = useTourStore((s) => s.close);
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { toursSeen, markTours } = useAuth();
  const autoStarted = useRef(false);
  const owed = toursSeen?.[tour] === TOUR_OWED;

  // Start once the page has painted what the first step points at. The
  // planner tour waits for a chosen major (first run has finished).
  useEffect(() => {
    if (autoStarted.current || running || !owed) return;
    if (tour === "planner" && !selectedProgramId) return;
    // Under 1024px the app shows its bigger-screen notice instead (SmallScreenNotice).
    if (!window.matchMedia?.("(min-width: 1024px)").matches) return;
    if (!autoStartAllowed()) return;
    // Ready = the page's first target is there AND the page has stopped
    // filling in: the number of cards / rows is the same for three polls in a
    // row (~1s). Starting earlier measured a board whose plan hadn't loaded,
    // and dropped the card steps.
    let tries = 0;
    let lastCount = -1;
    let steady = 0;
    const t = setInterval(() => {
      if (++tries > 60) return clearInterval(t);
      if (!document.querySelector(TOUR_READY[tour])) return;
      const count = document.querySelectorAll(TOUR_SETTLE[tour]).length;
      steady = count === lastCount ? steady + 1 : 0;
      lastCount = count;
      if (steady < 3) return;
      clearInterval(t);
      autoStarted.current = true;
      start(tour);
    }, 350);
    return () => clearInterval(t);
  }, [running, owed, tour, selectedProgramId, start]);

  if (running !== tour) return null;
  // Finishing and skipping both count as seen.
  const finish = () => {
    closeStore();
    useTopBarStore.getState().setMenuOpen(false); // the save step may have opened it
    if (owed) void markTours({ [tour]: TOUR_SEEN });
  };
  return <TourRun tour={tour} close={finish} />;
}

function useTourSteps(tour: TourId): TourStep[] {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs } = usePrograms();
  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  const path = tourPathFor(selectedProgramId, program);
  const college = program?.college ?? null;
  return useMemo(
    () =>
      tour === "planner"
        ? plannerSteps(path, college)
        : tour === "requirements"
          ? requirementsSteps()
          : classesSteps(),
    [tour, path, college]
  );
}

function TourRun({ tour, close }: { tour: TourId; close: () => void }) {
  const step = useTourStore((s) => s.step);
  const goTo = useTourStore((s) => s.goTo);
  const steps = useTourSteps(tour);

  // Steps whose targets aren't on screen (no next-semester card, say) drop
  // out up front so the counter never promises a step that won't show.
  // `step` is a deliberate extra dependency: it re-checks targets that appeared late.
  const visible = useMemo(
    () => steps.filter((s) => !s.target || s.revealedByEnter || !!measure(targetsOf(s)!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, step]
  );
  const current = visible[Math.min(step, visible.length - 1)];
  const last = step >= visible.length - 1;

  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  // How long this step's own panel animation runs (see TourStep.settleMs).
  const settleRef = useRef(0);

  // Each new step moves the hole in two beats (STAGED), then it goes back to
  // plain following. Runs before the step's `enter` and before the new target
  // is measured, so it can read whether a panel is about to animate open.
  useLayoutEffect(() => {
    settleRef.current = current?.settleMs?.() ?? 0;
    const spot = spotRef.current;
    if (!spot) return;
    spot.style.transition = STAGED;
    const t = setTimeout(() => {
      spot.style.transition = FOLLOW;
    }, settleRef.current + 700);
    return () => clearTimeout(t);
  }, [current]);

  // Enter the step: run its hook, bring the target into view.
  useEffect(() => {
    current?.enter?.();
    const sel = targetsOf(current)?.[0];
    const el = sel ? document.querySelector(sel) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [current]);

  // Follow the target every frame (the drawer slides, the canvas scrolls).
  useEffect(() => {
    let raf = 0;
    let prev: Box | null = null;
    const tick = () => {
      const sel = targetsOf(current);
      const next = sel ? measure(sel) : null;
      if (!same(prev, next)) {
        prev = next;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    const follow = () => {
      // Measure right away too, so the hole never waits on the first frame.
      const first = targetsOf(current);
      prev = first ? measure(first) : null;
      setBox(prev);
      raf = requestAnimationFrame(tick);
    };
    // A step that opens a panel lets it finish opening; the hole stays on the
    // last target until then, and moves once.
    const settle = settleRef.current;
    const wait = settle > 0 ? setTimeout(follow, settle) : null;
    if (!wait) follow();
    return () => {
      if (wait) clearTimeout(wait);
      cancelAnimationFrame(raf);
    };
  }, [current]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [current, box]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") {
        if (last) close();
        else goTo(step + 1);
      }
      else if (e.key === "ArrowLeft" && step > 0) goTo(step - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, goTo, last, step]);

  if (!current) return null;
  const pos = placeCard(box, cardH);
  // No target: the hole collapses to a point mid-screen, so the whole page dims.
  const hole = box ?? { x: window.innerWidth / 2, y: window.innerHeight / 2, w: 0, h: 0 };

  return (
    <div className="fixed inset-0 z-[var(--z-tour)]" role="dialog" aria-modal="true" aria-label="Planner tour">
      {/* Blocks every click on the page beneath. */}
      <div className="absolute inset-0" />
      {/* The spotlight: a rounded hole whose huge shadow is the dim layer. */}
      <div
        ref={spotRef}
        aria-hidden="true"
        className="pointer-events-none absolute rounded-xl ring-2 ring-white/70 motion-reduce:!transition-none"
        style={{
          left: hole.x,
          top: hole.y,
          width: hole.w,
          height: hole.h,
          boxShadow: "0 0 0 9999px rgb(10 12 16 / 0.62)",
        }}
      />
      <div
        ref={cardRef}
        className="absolute flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-2xl transition-[left,top] duration-300 ease-out"
        style={{ width: CARD_W, left: pos.left, top: pos.top }}
      >
        <div className="flex items-center justify-between">
          <p className="t-label text-ink-4">
            <span className="num">{step + 1}</span> of <span className="num">{visible.length}</span>
          </p>
          <button
            onClick={close}
            aria-label="Close the tour"
            className="-m-1 rounded-md p-1 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="t-headline text-[1.125rem]">{current.title}</h2>
        <div className="flex flex-col gap-2 t-body text-ink-2 [&_b]:font-semibold [&_b]:text-ink [&_li]:ml-4 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
          {current.body}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {visible.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-4 bg-ink" : "w-1.5 bg-line-strong"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step === 0 ? (
              <button onClick={close} className="t-meta text-ink-3 underline-offset-2 hover:underline">
                Skip tour
              </button>
            ) : (
              <button
                onClick={() => goTo(step - 1)}
                className="rounded-full border-[1.5px] border-line px-3.5 py-1.5 t-body font-semibold text-ink-2 transition-colors hover:border-ink-3"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? close() : goTo(step + 1))}
              className="rounded-full border-[1.5px] border-ink bg-ink px-4 py-1.5 t-body font-semibold text-canvas transition-opacity hover:opacity-90"
              autoFocus
            >
              {step === 0 ? "Show me around" : last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
