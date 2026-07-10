import {
  useRef,
  useEffect,
  useState,
  useLayoutEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { X, Check, Clock, Undo2, Minus, Trash2, Eraser, MoreHorizontal, Plus } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import type { ProgramSlotWithData, Course } from "@/types/db";
import type { SlotStatus } from "@/lib/planner/computeSlotStatusMap";
import { CATEGORY_META } from "@/lib/planner/slotCategory";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { dragState } from "@/lib/drag/dragState";
import { slotCredits, formatCredits, slotSearchSeed } from "@/lib/planner/semesters";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * SlotCard — the signature component of the roadmap (spec 004 §2, engine
 * surfacing spec 006 §B.3).
 *
 * Anatomy, top → bottom:
 *   1. Status rail: 3px full-width strip in the status base color. Reads at a
 *      glance across the whole grid; absent on empty available slots.
 *   2. Eyebrow row: the slot's IDENTITY — a fixed course's code, or the bucket/
 *      pattern name. A filled bucket KEEPS its bucket identity here while the
 *      chosen course takes the title line. Credits sit right-aligned in mono.
 *   3. Title + status line: the read-first element, plus a plain-language status
 *      line — "Needs CS 2110 first" (blocked), "Usually offered in Fall only"
 *      (wrong term), "In progress", "Waived". This is the whole answer to
 *      triage #10 "where is my engine?".
 *   4. Action row (hover/focus reveal, always-on for touch): Complete /
 *      In progress / Clear primary; Waive + structural actions in a "⋯" menu.
 *
 * Display precedence (spec 006 §B.1):
 *   Complete > In progress > Waived > Blocked (red) > Warning (amber) > Available.
 */

/** The card's resolved visual state — precedence-collapsed from the manual
 *  states (plan doc) and the derived states (engine). */
type CardVisual =
  | "completed"
  | "in-progress"
  | "waived"
  | "blocked"
  | "warning"
  | "available";

/** In-progress reuses the blue `drop` token family — the one distinct status
 *  hue left in the palette, and blue reads naturally as "active / currently
 *  taking". Blocked = red `destructive`; warning = amber `available` token. */
const statusStyles: Record<CardVisual, string> = {
  completed: "border-complete/60 bg-complete-tint",
  "in-progress": "border-drop/60 bg-drop-tint",
  waived: "border-waived/60 bg-waived-tint",
  blocked: "border-destructive/60 bg-destructive-tint",
  warning: "border-available/60 bg-available-tint",
  available: "border-line bg-surface",
};

const railStyles: Record<CardVisual, string> = {
  completed: "bg-complete",
  "in-progress": "bg-drop",
  waived: "bg-waived",
  blocked: "bg-destructive",
  warning: "bg-available",
  available: "bg-transparent",
};

const TERM_NAMES: Record<string, string> = {
  FA: "Fall",
  SP: "Spring",
  SU: "Summer",
  WI: "Winter",
};

/** "Needs CS 2110 first" — names the missing prereq/coreq leaves. Two leaves
 *  read as OR-alternatives (either fixes it); 3+ names two and trails off. */
function blockedMessage(leaves: string[]): string {
  if (leaves.length === 0) return "Prerequisites not met";
  if (leaves.length === 1) return `Needs ${leaves[0]} first`;
  if (leaves.length === 2) return `Needs ${leaves[0]} or ${leaves[1]} first`;
  return `Needs ${leaves[0]}, ${leaves[1]} …`;
}

/** "Usually offered in Fall only" — names the course's actual offered terms. */
function offeredMessage(offered: string[]): string {
  const names = offered.map((t) => TERM_NAMES[t] ?? t);
  if (names.length === 0) return "Check when this is offered";
  if (names.length === 1) return `Usually offered in ${names[0]} only`;
  const last = names[names.length - 1];
  return `Usually offered in ${names.slice(0, -1).join(", ")} or ${last}`;
}

/** Category accent (spec 006 §D1/§D2) — a tiny tag naming the slot's subject/role
 *  family (Math · Science · Eng · …) in its desaturated accent color. Color +
 *  label only, never a shape (shapes would break the uniform grid / drag ghost). */
function CategoryTag({ category }: { category: ProgramSlotWithData["category"] }) {
  if (!category) return null;
  const meta = CATEGORY_META[category];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-px t-meta font-medium",
        meta.text,
        meta.tint
      )}
      title={meta.label}
    >
      {meta.tag}
    </span>
  );
}

/** Term chips (spec 006 §D2) — "FA"/"SP" from the course's `offered` tokens
 *  (populated by roster-sync, fetched by useSlotStatus). Absent when there's no
 *  offered data, so an empty array reads as "no data", not "never offered". */
function TermChips({ offered }: { offered: string[] }) {
  if (offered.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {offered.map((t) => (
        <span
          key={t}
          className="rounded border border-line px-1 t-meta text-ink-3"
          title={TERM_NAMES[t] ?? t}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

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

/**
 * Overflow "⋯" menu (spec 006 §B.3 / triage #9b) — the home for the demoted
 * Waive/Unwaive action plus the secondary structural actions (take the course
 * out, remove the slot). Rendered through a portal so the card's
 * `overflow-hidden` can't clip it; closes on outside-click / Escape / scroll.
 */
function CardOverflowMenu({
  isWaived,
  placed,
  onWaive,
  onClear,
  onRemove,
}: {
  isWaived: boolean;
  placed: Course | null;
  onWaive: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Anchor the menu's right edge under the trigger, opening downward.
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 184) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left t-label transition-colors";

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { stop(e); setOpen((o) => !o); }}
        onPointerDown={stop}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="inline-flex items-center rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal className="h-3 w-3" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onPointerDown={stop}
            onClick={stop}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 min-w-[184px] rounded-lg border border-line bg-surface p-1 shadow-xl"
          >
            <button
              role="menuitem"
              onClick={(e) => { stop(e); onWaive(); setOpen(false); }}
              className={cn(item, "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              {isWaived ? <Undo2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              {isWaived ? "Remove waiver" : "Waive this requirement"}
            </button>
            {placed && (
              <button
                role="menuitem"
                onClick={(e) => { stop(e); onClear(); setOpen(false); }}
                className={cn(item, "text-ink-2 hover:bg-surface-2 hover:text-ink")}
              >
                <Eraser className="h-3.5 w-3.5" />
                Take the course out
              </button>
            )}
            <button
              role="menuitem"
              onClick={(e) => { stop(e); onRemove(); setOpen(false); }}
              className={cn(item, "text-ink-2 hover:bg-destructive-tint hover:text-destructive-text")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from roadmap
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** Action row (spec 006 §B.3) — Complete / In progress primary status toggles,
 *  Clear (shown only when a manual state is set) to return the slot to plain
 *  "planned", and the "⋯" overflow for Waive + structural actions. Real
 *  buttons, keyboard reachable. */
function ActionRow({
  isCompleted,
  isInProgress,
  isWaived,
  placed,
  onComplete,
  onInProgress,
  onClearStatus,
  onWaive,
  onClear,
  onRemove,
}: {
  isCompleted: boolean;
  isInProgress: boolean;
  isWaived: boolean;
  placed: Course | null;
  onComplete: () => void;
  onInProgress: () => void;
  onClearStatus: () => void;
  onWaive: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const hasManualState = isCompleted || isInProgress || isWaived;
  const chip = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 t-label transition-colors";
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 border-t border-line/60 px-1.5 py-1",
        "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
        "[@media(hover:none)]:opacity-100"
      )}
    >
      <button
        onClick={(e) => { stop(e); onComplete(); }}
        onPointerDown={stop}
        className={cn(
          chip,
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
        onClick={(e) => { stop(e); onInProgress(); }}
        onPointerDown={stop}
        className={cn(
          chip,
          isInProgress
            ? "text-drop-text hover:bg-drop/15"
            : "text-ink-3 hover:bg-surface-2 hover:text-ink"
        )}
        aria-label={isInProgress ? "No longer taking this" : "Mark as currently taking"}
      >
        <Clock className="h-3 w-3" />
        {isInProgress ? "Taking" : "In progress"}
      </button>
      {hasManualState && (
        <button
          onClick={(e) => { stop(e); onClearStatus(); }}
          onPointerDown={stop}
          className={cn(chip, "text-ink-3 hover:bg-surface-2 hover:text-ink")}
          aria-label="Clear this slot's status"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
      <span className="ml-auto flex items-center">
        <CardOverflowMenu
          isWaived={isWaived}
          placed={placed}
          onWaive={onWaive}
          onClear={onClear}
          onRemove={onRemove}
        />
      </span>
    </div>
  );
}

export function SlotCard({
  slot,
  slotStatus,
  registerRef,
  onChainHover,
  onCompleted,
}: {
  slot: ProgramSlotWithData;
  /** Unified engine status for this slot (spec 006 §B.2). */
  slotStatus: SlotStatus;
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
    inProgressSlotIds,
    slotSelections,
    selectedCourses,
    toggleCompleted,
    toggleWaived,
    toggleInProgress,
    clearSlot,
    assignSlot,
    removeSlot,
  } = usePlan();

  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const armedSourceSlotId = usePlannerStore((s) => s.armedSourceSlotId);
  const disarm = usePlannerStore((s) => s.disarm);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);
  const openCourseDetail = usePlannerStore((s) => s.openCourseDetail);

  const isCompleted = completedSlotIds.includes(slot.id);
  const isWaived = waivedSlotIds.includes(slot.id);
  const isInProgress = inProgressSlotIds.includes(slot.id);

  const selectedCourseId = slotSelections[slot.id] ?? null;
  const placed = selectedCourseId ? (selectedCourses[selectedCourseId] ?? null) : null;
  const templateCourse = slot.kind === "course" ? slot.courses : null;
  const hasContent = placed !== null || templateCourse !== null;
  // The course the engine actually evaluated (user pick wins, else template),
  // used for the "offered in …" warning copy and the term chips.
  const effectiveCourse = placed ?? templateCourse;
  // Real `offered` terms live on the full course doc (fetched by useSlotStatus's
  // ensureCourseDetails into CatalogProvider), not the display snapshot. Read
  // them here so the term chips + warning copy reflect the true terms; empty
  // until the doc lands, then upgrades on the next render.
  const { courseDetails } = useCatalogContext();
  const offered = (effectiveCourse && courseDetails[effectiveCourse.id]?.offered) ?? [];

  // ── Display precedence (spec 006 §B.1): manual states first, then derived. ──
  const visual: CardVisual = isCompleted
    ? "completed"
    : isInProgress
      ? "in-progress"
      : isWaived
        ? "waived"
        : slotStatus.blocked
          ? "blocked"
          : slotStatus.offeredOk === false
            ? "warning"
            : "available";

  const outerRef = useRef<HTMLDivElement>(null);
  const prevPlaced = useRef<string | null>(placed?.id ?? null);
  const dragCandidate = useRef<{ x: number; y: number } | null>(null);

  const isDraggingOut = useSyncExternalStore(
    dragState.subscribe,
    () =>
      dragState.get()?.mode === "course" &&
      dragState.get()?.courseId === placed?.id &&
      dragState.get()?.sourceSlotId === slot.id
  );
  // This card's SLOT is mid-move (slot mode) — render it ghosted in place.
  const isSlotMoving = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.mode === "slot" && dragState.get()?.sourceSlotId === slot.id
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

  // Drag with a 6px movement threshold (spec 004 §4 / 005 §9). A plain click
  // arms/places; movement starts a drag. What travels depends on the card:
  //   placed course → the COURSE travels (drop on slot or column);
  //   unfilled card → the SLOT itself travels (drop on a column).
  const onPointerDown = (e: React.PointerEvent) => {
    if (isDraggingOut || isSlotMoving) return;
    dragCandidate.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragCandidate.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      dragCandidate.current = null;
      disarm();
      if (placed) {
        dragState.start({
          courseId: placed.id,
          course: placed,
          sourceSlotId: slot.id,
          startX: e.clientX,
          startY: e.clientY,
        });
      } else {
        const d = getDisplay(slot, null);
        dragState.startSlotMove({
          slotId: slot.id,
          slotLabel: { eyebrow: d.eyebrow, title: d.title },
          startX: e.clientX,
          startY: e.clientY,
        });
      }
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
    // Clicking anywhere while armed-but-ineligible cancels the arm.
    if (armedCourse) {
      disarm();
      return;
    }
    // A plain click on the card BODY opens the course detail side-peek (spec 006
    // §D4). Moving a placed course is done by dragging (unchanged); the old
    // click-to-pick-up gesture is retired in favor of this higher-value action.
    if (effectiveCourse) openCourseDetail(effectiveCourse);
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

  // Clear the slot's manual status back to plain "planned". Exactly one manual
  // state is ever set, so toggling the active one off clears the row.
  const handleClearStatus = useCallback(() => {
    if (isCompleted) toggleCompleted(slot.id);
    else if (isInProgress) toggleInProgress(slot.id);
    else if (isWaived) toggleWaived(slot.id);
  }, [isCompleted, isInProgress, isWaived, slot.id, toggleCompleted, toggleInProgress, toggleWaived]);

  const isArmedSource = armedSourceSlotId === slot.id && armedCourse !== null;
  const display = getDisplay(slot, isDraggingOut || isArmedSource ? null : placed);
  const showAsEmpty = (!hasContent && !isDropTarget) || isDraggingOut || isArmedSource;
  const highlightForArm = armedCourse !== null && canReceiveArmed;
  const hasStatusMark = isCompleted || isInProgress || isWaived;

  // Plain-language status line under the title — the visible engine (triage #10).
  const statusLine: { text: string; className: string } | null =
    visual === "in-progress"
      ? { text: "In progress", className: "text-drop-text" }
      : visual === "waived"
        ? { text: "Waived", className: "text-waived-text" }
        : visual === "blocked"
          ? { text: blockedMessage(slotStatus.unmetPrereqLeaves), className: "text-destructive-text" }
          : visual === "warning"
            ? {
                text: offeredMessage(offered),
                className: "text-available-text",
              }
            : null;

  const ariaStatus = isCompleted
    ? ", completed"
    : isInProgress
      ? ", in progress"
      : isWaived
        ? ", waived"
        : visual === "blocked"
          ? `, blocked — ${blockedMessage(slotStatus.unmetPrereqLeaves)}`
          : visual === "warning"
            ? `, ${offeredMessage(offered)}`
            : "";

  const ariaLabel = placed
    ? `${display.metaCode ?? display.eyebrow} ${display.title}${ariaStatus}. Press Enter for course details.`
    : hasContent
      ? `${display.eyebrow} ${display.title}${ariaStatus}. Press Enter for course details.`
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
              "border-dashed border-line bg-transparent cursor-grab active:cursor-grabbing",
              highlightForArm && "border-solid border-drop bg-drop-tint/60 cursor-pointer"
            )
          : cn(
              statusStyles[visual],
              "cursor-grab active:cursor-grabbing",
              highlightForArm && "border-drop ring-1 ring-drop cursor-pointer"
            ),
        isDropTarget && "border-solid border-drop bg-drop-tint",
        isSlotMoving && "opacity-30"
      )}
    >
      {/* 1. Status rail */}
      {!showAsEmpty && (
        <div className={cn("h-[3px] w-full shrink-0", railStyles[visual])} aria-hidden="true" />
      )}

      {isDropTarget && showAsEmpty ? (
        <div className="flex flex-1 items-center justify-center py-4">
          <span className="t-body font-medium text-drop-text">Drop it here</span>
        </div>
      ) : showAsEmpty ? (
        /* Empty slot — keeps the bucket identity visible, quiet invite on arm.
           A manual mark (completed / in-progress / waived) on an empty bucket
           (spec 005 §11 — "my FWS is done, don't care which one") still shows
           its rail + tint. */
        <>
          {hasStatusMark && (
            <div className={cn("h-[3px] w-full shrink-0", railStyles[visual])} aria-hidden="true" />
          )}
          <div
            className={cn(
              "flex flex-1 flex-col justify-center gap-0.5 px-2.5 py-2",
              highlightForArm || hasStatusMark ? "opacity-90" : "opacity-45"
            )}
          >
            <div className="flex items-baseline justify-between gap-1.5">
              <p className="t-label truncate">{display.eyebrow}</p>
              {display.credits && (
                <p className="t-meta shrink-0"><span className="num">{display.credits} cr</span></p>
              )}
            </div>
            <p className={cn("line-clamp-2 t-body", isCompleted ? "text-complete-text" : "text-ink-2")}>
              {display.title}
            </p>
            {slot.category && (
              <div className="flex">
                <CategoryTag category={slot.category} />
              </div>
            )}
            {isCompleted && <p className="t-meta text-complete-text">Done — course not recorded</p>}
            {isInProgress && <p className="t-meta text-drop-text">In progress</p>}
            {isWaived && <p className="t-meta text-waived-text">Waived</p>}
            {highlightForArm && armedCourse && (
              <p className="t-meta text-drop-text">
                Place {armedCourse.subject} {armedCourse.number} here
              </p>
            )}
            {/* ＋ Find a class (spec 006 §D3) — turns dead grey into an invite;
                opens the catalog drawer pre-seeded to this slot's rule/pattern.
                Hidden while a course is armed (the "Place … here" hint owns the
                click then) or a manual mark stands in for a real course. */}
            {!highlightForArm && !hasStatusMark && (
              <button
                onClick={(e) => { e.stopPropagation(); requestCatalogSearch(slotSearchSeed(slot)); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="mt-0.5 inline-flex w-fit items-center gap-1 rounded t-meta font-medium text-drop-text opacity-80 transition-opacity hover:opacity-100"
                aria-label={`Find a class for ${display.title}`}
              >
                <Plus className="h-2.5 w-2.5" />
                Find a class
              </button>
            )}
          </div>
          <ActionRow
            isCompleted={isCompleted}
            isInProgress={isInProgress}
            isWaived={isWaived}
            placed={null}
            onComplete={handleToggleCompleted}
            onInProgress={() => toggleInProgress(slot.id)}
            onClearStatus={handleClearStatus}
            onWaive={() => toggleWaived(slot.id)}
            onClear={() => {}}
            onRemove={() => { disarm(); removeSlot(slot.id); }}
          />
        </>
      ) : (
        <>
          {/* 2+3. Eyebrow + title + status line */}
          <div className="flex flex-1 flex-col gap-0.5 px-2.5 pb-1.5 pt-1.5">
            <div className="flex items-baseline justify-between gap-1.5">
              <p className="t-label truncate">{display.eyebrow}</p>
              {display.credits && (
                <span className="t-meta shrink-0"><span className="num">{display.credits} cr</span></span>
              )}
            </div>
            <p className={cn("line-clamp-3 t-body font-semibold", isCompleted && "text-complete-text")}>
              {display.title}
            </p>
            {display.metaCode && <p className="t-meta">{display.metaCode}</p>}
            {/* Taxonomy row (spec 006 §D2): category accent + offered terms,
                grouped on one quiet line below the title. */}
            {(slot.category || offered.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                <CategoryTag category={slot.category} />
                <TermChips offered={offered} />
              </div>
            )}
            {statusLine && <p className={cn("t-meta font-medium", statusLine.className)}>{statusLine.text}</p>}
          </div>

          <ActionRow
            isCompleted={isCompleted}
            isInProgress={isInProgress}
            isWaived={isWaived}
            placed={placed}
            onComplete={handleToggleCompleted}
            onInProgress={() => toggleInProgress(slot.id)}
            onClearStatus={handleClearStatus}
            onWaive={() => toggleWaived(slot.id)}
            onClear={() => { disarm(); clearSlot(slot.id); }}
            onRemove={() => { disarm(); removeSlot(slot.id); }}
          />
        </>
      )}
    </div>
  );
}
