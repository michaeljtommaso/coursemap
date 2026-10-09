import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Clock,
  Trash2,
  MoreHorizontal,
  TriangleAlert,
  Info,
  ArrowRight,
  ArrowUpToLine,
  ChevronLeft,
} from "lucide-react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";
import type { ProgramSlotWithData, Course } from "@/types/db";
import {
  semesterPrereqPools,
  type SlotStatus,
} from "@/lib/planner/computeSlotStatusMap";
import { prereqProgress, type PrereqProgress } from "@/lib/planner/prereqProgress";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import { resolveCardStatusLine, mentionsCredit, creditCouldUnblock } from "@/lib/planner/statusLine";
import { CREDIT_EQUIVALENCIES } from "@/data/credit-equivalencies";
import { CATEGORY_META, courseCategory } from "@/lib/planner/slotCategory";
import { usePlan } from "@/hooks/usePlan";
import { buildBoard } from "@/lib/planner/board";
import { NO_PICKS } from "@/hooks/useEnrichedPlan";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useUnlocksMap } from "@/contexts/UnlocksContext";
import { useSlotHorizon } from "@/contexts/HorizonContext";
import { useReviews } from "@/contexts/ReviewsProvider";
import { variesByInstructor } from "@/lib/planner/reviews";
import { VariesByInstructorBadge } from "@/components/reviews/ProfessorReview";
import { unlockCount } from "@/lib/planner/unlocks";
import {
  sectionInstructorNames,
  formatMeetingChip,
  openStatusKind,
  openStatusWord,
} from "@/lib/planner/sections";
import { dragState } from "@/lib/drag/dragState";
import { useDragSource } from "@/hooks/useDragSource";
import { positionOf } from "@/lib/planner/placementOps";
import { slotCredits, formatCredits, semesterLabel } from "@/lib/planner/semesters";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * SlotCard — the signature component of the roadmap (spec 004 §2, engine
 * surfacing spec 006 §B.3, card direction 11 · claude-design-2026-07-11).
 *
 * Placement model (spec 014 §D1): EVERY card is a placed course. `slot` is the
 * engine slot useBoard synthesizes for one placement (id = placement id,
 * courses = the course, suggested_semester = its column). There are no empty
 * requirement cards, no slot-vs-course drag split, no waive-on-card (waivers
 * live on requirements, in the checklist). Its menu: Mark complete /
 * In progress / Remove from board (with Undo, spec 014 §D8).
 *
 * Anatomy, top → bottom (the direction-11 "live border on a white body" card):
 *   1. Chassis: a 2px status-colored ring (radius 8) around a --surface body
 *      (radius 6). Two conic-gradient layers clipped inside the ring give the
 *      "live border" glint — a slow always-on spin plus a faster layer that
 *      fades in on hover. Reduced motion → static ring, no spin.
 *   2. Eyebrow row: 8px category dot · the slot's IDENTITY (course code or
 *      bucket name, Manrope 800 uppercase) · status glyph circle · credits pill.
 *      A filled bucket KEEPS its bucket identity here while the chosen course
 *      takes the title line.
 *   3. Title (2-line clamp) + plain-language status line — "Needs CS 2110
 *      first" (blocked), "Usually offered in Fall only" (wrong term),
 *      "In progress", "Waived". The visible engine (triage #10).
 *   4. Bottom meta row: category tag chip · PRE met/total counter · term chips.
 *   5. Corner-morph actions: a bottom-right "⋯" pill that widens on hover/
 *      focus-within (always expanded on touch) into Complete / In progress /
 *      Clear / overflow "⋯" (the full "Course actions" menu: Mark complete /
 *      In progress / Move to… / Remove from board).
 *
 * Drag (spec 014 §D3): the shared useDragSource hook — 6px threshold with
 * document listeners (mouse), ~250ms long-press (touch). While its course is
 * in flight the card shows as a dashed placeholder at home; once the drag
 * hovers an insertion point it is hidden, and the column's dashed outline
 * shows where it will land.
 *
 * Display precedence (spec 007 §1b, extending spec 006 §B.1):
 *   Complete > In progress > Blocked (red) > Warning (amber) >
 *   Advisory (quiet ink) > Available.
 */

/** The card's resolved visual state — precedence-collapsed from the manual
 *  states (plan doc) and the derived states (engine). */
type CardVisual =
  | "completed"
  | "in-progress"
  | "blocked"
  | "warning"
  | "advisory"
  | "available";

/** Ring/glint/badge hues per state (direction 11). In-progress reuses the blue
 *  `drop` family; blocked = red `destructive`; warning = amber `available`
 *  (warning-only — the Available card state itself renders a NEUTRAL ring).
 *  Advisory (spec 007 §1b) is deliberately QUIET — the SAME neutral ring
 *  family as Available (never red/amber, no halo), with an ink-toned badge so
 *  the info glyph is still visible against the white body. */
const RING: Record<CardVisual, { ring: string; glint: string; badge: string | null }> = {
  completed: { ring: "var(--complete-bd)", glint: "var(--complete)", badge: "var(--complete)" },
  "in-progress": { ring: "var(--drop-bd)", glint: "var(--drop)", badge: "var(--drop)" },
  blocked: { ring: "var(--destructive-bd)", glint: "var(--destructive)", badge: "var(--destructive)" },
  warning: { ring: "var(--available-bd)", glint: "var(--available)", badge: "var(--available)" },
  advisory: { ring: "var(--border)", glint: "var(--border-strong)", badge: "var(--text-3)" },
  available: { ring: "var(--border)", glint: "var(--border-strong)", badge: null },
};

/** The two-position conic glint the live border spins (verbatim stop layout
 *  from the prototype; angle driven by the registered --bA custom property). */
function conicGlint(glint: string): string {
  return `conic-gradient(from var(--bA), transparent 0deg, ${glint} 55deg, transparent 115deg, transparent 180deg, ${glint} 235deg, transparent 295deg)`;
}

const TERM_NAMES: Record<string, string> = {
  FA: "Fall",
  SP: "Spring",
  SU: "Summer",
  WI: "Winter",
};

/** Category accent (spec 006 §D1/§D2) — a tiny tag naming the slot's subject/role
 *  family (Math · Science · Eng · …) in its desaturated accent color. Color +
 *  label only, never a shape (shapes would break the uniform grid / drag ghost). */
function CategoryTag({ category }: { category: ProgramSlotWithData["category"] }) {
  if (!category) return null;
  const meta = CATEGORY_META[category];
  return (
    <span
      className={cn(
        "flex-none rounded-[3px] px-1 text-[8.5px] font-bold leading-[1.7]",
        meta.text,
        meta.tint
      )}
      title={meta.label}
    >
      {meta.tag}
    </span>
  );
}

/** PRE counter (direction 11) — "PRE 1/1 ✓" / "PRE 0/1 ✕" / "PRE —": met/total
 *  of the course's TOP-LEVEL prerequisite requirements, from the pure
 *  prereqProgress helper over the engine's own pools. Green when all met, red
 *  when any unmet, quiet gray when the course has no prerequisites at all. */
function PreCounter({ progress }: { progress: PrereqProgress }) {
  const { met, total } = progress;
  const ok = total > 0 && met >= total;
  return (
    <span
      title="Prerequisites met"
      className={cn(
        "num flex-none text-[8.5px] font-medium",
        total === 0 ? "text-ink-4" : ok ? "text-complete-text" : "text-destructive-text"
      )}
    >
      PRE {total === 0 ? "—" : `${met}/${total} ${ok ? "✓" : "✕"}`}
    </span>
  );
}

/** 13px status glyph circle in the eyebrow row (lucide equivalents of the
 *  prototype's ✓ ◷ – ✕ ! glyphs). Pops via glyph-pop-a/b on manual state
 *  changes (`popAnim` alternates names so consecutive changes retrigger). */
function StatusGlyph({ visual, popAnim }: { visual: CardVisual; popAnim: string | null }) {
  const badge = RING[visual].badge;
  if (!badge) return null;
  const Icon =
    visual === "completed"
      ? Check
      : visual === "in-progress"
        ? Clock
        : visual === "blocked"
          ? X
          : visual === "advisory"
            ? Info
            : TriangleAlert; // warning
  return (
    <span
      aria-hidden="true"
      className="flex h-[13px] w-[13px] flex-none items-center justify-center rounded-full text-white"
      style={{ background: badge, animation: popAnim ?? undefined }}
    >
      <Icon className="h-[9px] w-[9px]" strokeWidth={3} />
    </span>
  );
}

type Display = {
  eyebrow: string;
  title: string;
  credits: string | null;
};

/** The card IS the course (spec 009 §1, spec 014 §D1): eyebrow = its code,
 *  title = its title, credits = its credits. */
function getDisplay(slot: ProgramSlotWithData, course: Course | null): Display {
  const credits = formatCredits(slotCredits(slot, course));
  if (course) {
    return { eyebrow: `${course.subject} ${course.number}`, title: course.title, credits };
  }
  return { eyebrow: "—", title: "Unknown course", credits };
}

/** One "Move to…" destination (spec 014 §D7). */
type MoveOption = { sem: number; label: string; current: boolean };

/**
 * "Course actions" menu (spec 014 §D7/§D8) — Mark complete / In progress /
 * Move to… / Remove from board. "Move to…" swaps the menu to a list of
 * semesters (each appends the course to the bottom of that column) plus "Top
 * of this column" — the keyboard path for everything drag does, calling the
 * same movePlacement. Rendered through a portal so the card body's
 * `overflow-hidden` can't clip it; closes on outside-press / Escape / scroll.
 * Arrow keys / Home / End move between items; focus lands on the first item.
 */
function CardOverflowMenu({
  courseLabel,
  isCompleted,
  isInProgress,
  moveOptions,
  onComplete,
  onInProgress,
  onMoveTo,
  onMoveTop,
  onRemove,
}: {
  courseLabel: string;
  isCompleted: boolean;
  isInProgress: boolean;
  moveOptions: MoveOption[];
  onComplete: () => void;
  onInProgress: () => void;
  onMoveTo: (sem: number) => void;
  onMoveTop: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "move">("main");
  const [pos, setPos] = useState<
    { left: number; top?: number; bottom?: number; maxHeight: number } | null
  >(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // Anchor under the trigger (measured when it opens); flip up when there's
  // clearly more room above — the semester list is tall.
  const placeMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, r.right - 200);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    setPos(
      below >= 280 || below >= above
        ? { left, top: r.bottom + 4, maxHeight: Math.max(160, below) }
        : { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(160, above) }
    );
  };

  // Focus the first item whenever the menu opens or switches view.
  useEffect(() => {
    if (!open || !pos) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, pos, view]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      // Scrolling the menu's own list must not close it.
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
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

  // Roving focus between the menu's items.
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" && view === "move") {
      e.preventDefault();
      setView("main");
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = i <= 0 ? items.length - 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    items[next]?.focus();
  };

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    stop(e);
    setOpen(false);
    fn();
  };

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left t-label transition-colors focus-visible:outline-none focus-visible:bg-surface-2";
  const plain = "text-ink-2 hover:bg-surface-2 hover:text-ink";

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => {
          stop(e);
          setView("main");
          if (!open) placeMenu();
          setOpen(!open);
        }}
        onPointerDown={stop}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Course actions"
        title="Course actions"
        className="flex h-4 w-[26px] flex-none items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
      >
        <MoreHorizontal className="h-3 w-3" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={view === "move" ? `Move ${courseLabel} to` : `${courseLabel} actions`}
            onPointerDown={stop}
            onClick={stop}
            onKeyDown={onMenuKeyDown}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 min-w-[200px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl"
          >
            {view === "main" ? (
              <>
                <button
                  role="menuitem"
                  onClick={run(onComplete)}
                  className={cn(item, isCompleted ? "text-complete-text hover:bg-surface-2" : plain)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark complete
                  {isCompleted && (
                    <Check aria-hidden="true" className="ml-auto h-3 w-3 text-complete-text" />
                  )}
                </button>
                <button
                  role="menuitem"
                  onClick={run(onInProgress)}
                  className={cn(item, isInProgress ? "text-drop-text hover:bg-surface-2" : plain)}
                >
                  <Clock className="h-3.5 w-3.5" />
                  In progress
                  {isInProgress && (
                    <Check aria-hidden="true" className="ml-auto h-3 w-3 text-drop-text" />
                  )}
                </button>
                <button
                  role="menuitem"
                  aria-haspopup="menu"
                  onClick={(e) => {
                    stop(e);
                    setView("move");
                  }}
                  className={cn(item, plain)}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Move to…
                </button>
                <button
                  role="menuitem"
                  onClick={run(onRemove)}
                  className={cn(item, "text-ink-2 hover:bg-destructive-tint hover:text-destructive-text")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from board
                </button>
              </>
            ) : (
              <>
                <button
                  role="menuitem"
                  aria-label="Back"
                  onClick={(e) => {
                    stop(e);
                    setView("main");
                  }}
                  className={cn(item, "text-ink-3 hover:bg-surface-2 hover:text-ink")}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Move {courseLabel} to
                </button>
                <div role="separator" className="my-1 h-px bg-line" />
                <button role="menuitem" onClick={run(onMoveTop)} className={cn(item, plain)}>
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                  Top of this column
                </button>
                {moveOptions.map((o) => (
                  <button
                    key={o.sem}
                    role="menuitem"
                    data-move-sem={o.sem}
                    aria-current={o.current ? "true" : undefined}
                    onClick={run(() => onMoveTo(o.sem))}
                    className={cn(item, plain)}
                  >
                    <span className="num">{o.label}</span>
                    {o.current && <span className="ml-auto t-meta text-ink-4">bottom</span>}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** Corner-morph actions (direction 11) — a bottom-right 24px "⋯" pill that
 *  widens on hover/focus-within (`width .22s cubic-bezier(.3,1.2,.4,1)`,
 *  slight overshoot) into ✓ Complete / ◷ In progress / ✕ Clear (only when a
 *  manual state is set) / ⋯ overflow. Touch-only devices (`any-hover:none`
 *  — no input can hover, so hover-reveal is impossible) keep the pill
 *  expanded; keyboard focus expands it too. NB: plain `hover:none` was wrong
 *  — it matches hybrid touch+mouse laptops (primary pointer reported as
 *  touch), pinning the pill open even with a mouse attached. Same
 *  handlers/semantics as the old ActionRow — keyboard reachable, aria copy.
 *  old ActionRow — real buttons, keyboard reachable, aria copy preserved. */
function CornerActions({
  courseLabel,
  isCompleted,
  isInProgress,
  moveOptions,
  onComplete,
  onInProgress,
  onClearStatus,
  onMoveTo,
  onMoveTop,
  onRemove,
}: {
  courseLabel: string;
  isCompleted: boolean;
  isInProgress: boolean;
  moveOptions: MoveOption[];
  onComplete: () => void;
  onInProgress: () => void;
  onClearStatus: () => void;
  onMoveTo: (sem: number) => void;
  onMoveTop: () => void;
  onRemove: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const hasManualState = isCompleted || isInProgress;
  const btn =
    "flex h-4 w-[26px] flex-none items-center justify-center rounded-lg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink";

  return (
    <div
      onClick={stop}
      onPointerDown={stop}
      className={cn(
        "absolute bottom-1 right-1.5 flex h-5 w-6 items-center justify-center overflow-hidden rounded-[10px] bg-surface-2",
        "[transition:width_.22s_cubic-bezier(.3,1.2,.4,1)]",
        // 2 status toggles + overflow; Clear joins only while a manual state
        // is set (literal class pairs so Tailwind's scanner sees both widths).
        hasManualState
          ? "group-hover:w-[116px] group-focus-within:w-[116px] [@media(any-hover:none)]:w-[116px]"
          : "group-hover:w-[90px] group-focus-within:w-[90px] [@media(any-hover:none)]:w-[90px]"
      )}
    >
      <span
        aria-hidden="true"
        className="absolute text-[11px] font-bold leading-none text-ink-3 transition-opacity duration-[120ms] group-hover:opacity-0 group-focus-within:opacity-0 [@media(any-hover:none)]:opacity-0"
      >
        ⋯
      </span>
      <div
        className={cn(
          "pointer-events-none flex gap-px opacity-0",
          "transition-opacity delay-[60ms] duration-150",
          "group-hover:pointer-events-auto group-hover:opacity-100",
          "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          "[@media(any-hover:none)]:pointer-events-auto [@media(any-hover:none)]:opacity-100"
        )}
      >
        <button
          onClick={(e) => { stop(e); onComplete(); }}
          onPointerDown={stop}
          className={cn(btn, isCompleted ? "text-complete-text" : "text-ink-3")}
          title="Mark completed"
          aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { stop(e); onInProgress(); }}
          onPointerDown={stop}
          className={cn(btn, isInProgress ? "text-drop-text" : "text-ink-3")}
          title="Mark as currently taking"
          aria-label={isInProgress ? "No longer taking this" : "Mark as currently taking"}
        >
          <Clock className="h-3 w-3" />
        </button>
        {hasManualState && (
          <button
            onClick={(e) => { stop(e); onClearStatus(); }}
            onPointerDown={stop}
            className={cn(btn, "text-ink-4")}
            title="Clear status"
            aria-label="Clear this course's status"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <CardOverflowMenu
          courseLabel={courseLabel}
          isCompleted={isCompleted}
          isInProgress={isInProgress}
          moveOptions={moveOptions}
          onComplete={onComplete}
          onInProgress={onInProgress}
          onMoveTo={onMoveTo}
          onMoveTop={onMoveTop}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}

const NO_PROGRESS: PrereqProgress = { met: 0, total: 0 };

export function SlotCard({
  slot,
  slotStatus,
  registerRef,
  onChainHover,
  onCompleted,
  attribution,
}: {
  /** The engine slot for ONE placement (useBoard): id = placement id. */
  slot: ProgramSlotWithData;
  /** Unified engine status for this placement (spec 006 §B.2). */
  slotStatus: SlotStatus;
  /** EdgeLayer measures cards through this registry. */
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  /** Chain highlighting: hover/focus enters, null leaves. */
  onChainHover: (slotId: string | null) => void;
  /** Completion pulse hook for the edge layer. */
  onCompleted: (slotId: string) => void;
  /** Requirement labels this placement counts toward (spec 014 §D1, from
   *  useRequirementProgress().attribution). Empty/undefined → no label. */
  attribution?: string[];
}) {
  const {
    placements,
    placedCourses,
    completedIds,
    inProgressIds,
    toggleCompleted,
    toggleInProgress,
    addPlacement,
    movePlacement,
    removePlacement,
  } = usePlan();

  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const armedSourceSlotId = usePlannerStore((s) => s.armedSourceSlotId);
  const disarm = usePlannerStore((s) => s.disarm);
  const openCourseDetail = usePlannerStore((s) => s.openCourseDetail);

  const isCompleted = completedIds.includes(slot.id);
  const isInProgress = inProgressIds.includes(slot.id);

  // Every card is a placed course (spec 014 §D1).
  const placed = slot.courses;
  // Real `offered` terms live on the full course doc (fetched by useSlotStatus's
  // ensureCourseDetails into CatalogProvider), not the display snapshot. Read
  // them here so the term chips + warning copy reflect the true terms; empty
  // until the doc lands, then upgrades on the next render.
  const { courseDetails } = useCatalogContext();
  const offered = (placed && courseDetails[placed.id]?.offered) ?? [];

  // Quiet "unlocks N" signal (spec 008 §3b) — how many later courses this placed
  // course opens. From the shared UnlocksMap (RoadmapCanvas provides it via
  // context — no prop threading through SemesterColumn). 0 (hidden) when the
  // catalog index predates the `unlocks` field (spec 008 §6 data gate).
  const unlocksMap = useUnlocksMap();
  const unlocksN = placed ? unlockCount(unlocksMap, placed.id) : 0;

  // ── Time-horizon near face (spec 012 §2) — instructor / meeting / open-status,
  //    read from HorizonContext (empty → "far" everywhere, i.e. today's face, so
  //    a card outside the provider or before config makes ZERO false claims). ──
  const slotHorizon = useSlotHorizon(slot.id);
  const nearSection = slotHorizon.primarySection;
  const nearInstructors = nearSection ? sectionInstructorNames(nearSection) : [];
  const nearInstructorLine = nearInstructors.join(", ");
  const nearMeeting = nearSection ? formatMeetingChip(nearSection) : null;
  const nearOpen = nearSection ? openStatusKind(nearSection.openStatus) : null;
  // ── Reviews near face (spec 013 §3d) — the card carries ONLY the quiet
  //    "varies by instructor" badge (no ratings on the card itself this unit —
  //    keep cards calm; the detail panel carries the numbers + the timeline).
  //    NEAR-HORIZON ONLY: fetched via the ReviewsProvider seam only for the
  //    near, offered course; under the NullAdapter getCourseView resolves to
  //    null → the badge never appears (the kill switch). ──
  const reviews = useReviews();
  const [showVariesBadge, setShowVariesBadge] = useState(false);
  const nearCourseId = slotHorizon.horizon === "near" && placed ? placed.id : null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!nearCourseId) {
        if (!cancelled) setShowVariesBadge(false);
        return;
      }
      const view = await reviews.getCourseView(nearCourseId);
      if (!cancelled) setShowVariesBadge(!!view && variesByInstructor(view.perProfessor));
    })();
    return () => {
      cancelled = true;
    };
  }, [reviews, nearCourseId]);

  // Near column, target configured, and the course's `roster` slug is KNOWN to
  // differ from the target — the honest proxy (the sync's roster field, ⚠️ not
  // roster_id, which is a numeric crseId). notOfferedThisTerm is already false
  // when roster is null (pre-fix docs / snapshots): never claim from missing
  // data.
  const showNotOffered = slotHorizon.notOfferedThisTerm && placed !== null;

  // ── PRE counter (direction 11): met/total of top-level prereq requirements,
  //    over the SAME pools the engine reads (semesterPrereqPools over the
  //    board's engine slots, credit profile included — the engine folds the
  //    credit pool into every evaluate() call, so the counter must too or a
  //    credit-met card would read "PRE 0/1 ✕" while its ring reads met) so the
  //    counter can never disagree with `blocked`. The expr comes from the full
  //    course doc (snapshots carry null → "PRE —" until the doc lands, exactly
  //    when the engine reads neutral too). ──────
  const { creditProfile, enteringYear } = useAuth();
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);
  // Detail doc wins WHOLESALE when cached (mirrors enrichCourse), else the
  // snapshot's own expr — so this reads exactly what the engine evaluated.
  const cardDoc = placed ? (courseDetails[placed.id] ?? placed) : null;
  const prereqExpr = cardDoc?.prereq_expr ?? null;
  const preProgress = useMemo<PrereqProgress>(() => {
    if (!prereqExpr) return NO_PROGRESS;
    const { engineSlots } = buildBoard(placements, placedCourses);
    const pools = semesterPrereqPools(
      engineSlots,
      completedIds,
      NO_PICKS,
      placedCourses,
      slot.suggested_semester,
      creditCourses
    );
    return prereqProgress(prereqExpr, {
      completedIds: pools.completedIds,
      completedCodes: pools.completedCodes,
      concurrentIds: pools.concurrentIds,
    });
  }, [prereqExpr, placements, placedCourses, completedIds, slot.suggested_semester, creditCourses]);

  // ── Display precedence (spec 007 §1b, extending spec 006 §B.1): manual
  //    states first, then derived — blocked > warning > advisory > available. ──
  const visual: CardVisual = isCompleted
    ? "completed"
    : isInProgress
      ? "in-progress"
      : slotStatus.blocked
        ? "blocked"
        : slotStatus.offeredOk === false
          ? "warning"
          : slotStatus.prereqState === "advisory"
            ? "advisory"
            : "available";

  // ── Status-line precedence (spec 007 §1b) — the pure, tested resolver:
  //    blocked > offered warning > overlap > advisory > nothing. Computed
  //    regardless of manual state; only consumed below when the card isn't
  //    showing a manual-state line instead. ──
  const cardLine = resolveCardStatusLine({
    blocked: slotStatus.blocked,
    unmetPrereqLeaves: slotStatus.unmetPrereqLeaves,
    offeredOk: slotStatus.offeredOk,
    offered,
    overlaps: slotStatus.overlaps,
    // Near-horizon time conflict (spec 012 §4) — amber, advisory, after overlap.
    conflictWith: slotHorizon.conflictWith,
    prereqState: slotStatus.prereqState,
    advisoryNotes: slotStatus.advisoryNotes,
  });

  const outerRef = useRef<HTMLDivElement>(null);

  // This card's in-flight face (spec 014 §D4): "placeholder" = its course is
  // being dragged but hovers no insertion point (a dashed card at home, where a
  // failed drop returns); "hidden" = the drag hovers an insertion point, so the
  // column's outline shows the destination and the cards close the gap.
  const dragFace = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    if (!s || s.phase !== "dragging" || s.sourcePlacementId !== slot.id) return "none";
    return s.over ? "hidden" : "placeholder";
  });
  const isDraggingOut = dragFace !== "none";

  // Still-needed panel highlight (spec 014 §D2): a ring on the covering cards;
  // the first one scrolls into view.
  const isHighlighted = usePlannerStore((s) => s.highlightedPlacementIds.includes(slot.id));
  const isFirstHighlighted = usePlannerStore((s) => s.highlightedPlacementIds[0] === slot.id);
  useEffect(() => {
    if (!isFirstHighlighted) return;
    outerRef.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [isFirstHighlighted]);

  // An armed course (click-to-place, spec 004 §4) can land in this card's
  // column — except back onto its own source placement (a no-op).
  const canReceiveArmed = armedCourse !== null && armedSourceSlotId !== slot.id;

  useEffect(() => {
    registerRef(slot.id, outerRef.current);
    return () => registerRef(slot.id, null);
  }, [slot.id, registerRef]);

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

  // ── State-change feedback (direction 11): when a manual state changes, the
  //    glyph pops (glyph-pop-a/b, alternating so consecutive changes retrigger)
  //    and the ring runs one sweep. Triggered from the action handlers (the
  //    prototype's `setStatus` sweep-counter pattern); reduced motion → none. ──
  const [fx, setFx] = useState<{ n: number; sweeping: boolean }>({ n: 0, sweeping: false });
  const triggerStatusFx = () => {
    if (prefersReducedMotion()) return;
    setFx((f) => ({ n: f.n + 1, sweeping: true }));
  };
  const ab = fx.n % 2 ? "a" : "b";
  const popAnim = fx.n > 0 ? `glyph-pop-${ab} .45s cubic-bezier(.34,1.56,.64,1)` : null;
  const sweepAnim = `ring-sweep-${ab} .5s cubic-bezier(.2,0,.2,1)`;

  // Drag (spec 014 §D3): the shared drag-start hook — a plain click (sub-6px
  // press) still opens the detail panel; movement (mouse) or a held press
  // (touch) starts a drag. The COURSE travels, keyed to this placement
  // (sourcePlacementId) so the drop MOVES it; `home` makes a drop back on its
  // own position a no-op.
  const { onPointerDown: onDragPointerDown } = useDragSource({
    disabled: !placed || isDraggingOut,
    onStart: ({ x, y }) => {
      if (!placed) return;
      disarm();
      const el = outerRef.current;
      const r = el?.getBoundingClientRect();
      dragState.start({
        course: placed,
        sourcePlacementId: slot.id,
        home: positionOf(placements, slot.id),
        startX: x,
        startY: y,
        originRect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
        sourceEl: el ?? null,
      });
    },
  });

  // "Move to…" (spec 014 §D7): every board semester (1–8, plus 9–10 once
  // used), labelled with its term name. The same movePlacement drag uses.
  const homeSem = slot.suggested_semester;
  const moveOptions = useMemo<MoveOption[]>(() => {
    const sems = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const p of placements) if (p.sem >= 1 && p.sem <= 10) sems.add(p.sem);
    return [...sems]
      .sort((a, b) => a - b)
      .map((sem) => {
        const l = semesterLabel(sem, enteringYear);
        return {
          sem,
          label: enteringYear ? l.primary : `${l.primary} · ${l.yearWord}`,
          current: sem === homeSem,
        };
      });
  }, [placements, enteringYear, homeSem]);

  // After a keyboard move the card remounts in its new column — keep focus on it.
  const refocus = (id: string) =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-placement="${CSS.escape(id)}"]`)?.focus()
    );
  const handleMoveTo = (sem: number) => {
    movePlacement(slot.id, sem, Number.MAX_SAFE_INTEGER); // append to the bottom
    refocus(slot.id);
  };
  const handleMoveTop = () => {
    movePlacement(slot.id, homeSem, 0);
    refocus(slot.id);
  };

  const handleClick = (e?: React.MouseEvent) => {
    // Click-to-place: an armed course clicked onto a card is inserted at that
    // card's position — before it from its top half (or the keyboard), after
    // it from its bottom half (spec 014: nothing is ever replaced).
    if (armedCourse && canReceiveArmed) {
      const here = positionOf(placements, slot.id);
      const r = outerRef.current?.getBoundingClientRect();
      const after = !!(e && r && r.height > 0 && e.clientY > r.top + r.height / 2);
      addPlacement(armedCourse, homeSem, here ? here.index + (after ? 1 : 0) : undefined);
      disarm();
      return;
    }
    // Clicking anywhere while armed-but-ineligible cancels the arm.
    if (armedCourse) {
      disarm();
      return;
    }
    // A plain click on the card BODY opens the course detail side-peek (spec 006
    // §D4).
    if (placed) openCourseDetail(placed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const handleToggleCompleted = useCallback(() => {
    const wasCompleted = completedIds.includes(slot.id);
    toggleCompleted(slot.id);
    if (!wasCompleted) onCompleted(slot.id); // edge pulse (spec 004 brief)
  }, [completedIds, slot.id, toggleCompleted, onCompleted]);

  // Clear the card's manual status back to plain "planned". Exactly one manual
  // state is ever set, so toggling the active one off clears the row.
  const handleClearStatus = useCallback(() => {
    if (isCompleted) toggleCompleted(slot.id);
    else if (isInProgress) toggleInProgress(slot.id);
  }, [isCompleted, isInProgress, slot.id, toggleCompleted, toggleInProgress]);

  const isArmedSource = armedSourceSlotId === slot.id && armedCourse !== null;
  const display = getDisplay(slot, placed);
  // While its course is being dragged (or armed) out, the card shows as a quiet
  // dashed placeholder in place.
  const showAsEmpty = isDraggingOut || isArmedSource;
  const highlightForArm = armedCourse !== null && canReceiveArmed;

  // The card's accent is derived FROM THE COURSE (spec 009 §1).
  const displayCategory = placed ? courseCategory(placed.subject) : slot.category;

  // Plain-language status line under the title — the visible engine (triage
  // #10). Manual states win outright; otherwise defer to the tested
  // blocked > warning > overlap > advisory precedence (spec 007 §1b).
  const statusLine: { text: string; className: string } | null =
    visual === "in-progress"
      ? { text: "In progress", className: "text-drop-text" }
      : visual === "completed"
        ? null
        : cardLine
          ? {
              text: cardLine.text,
              className:
                cardLine.kind === "blocked"
                  ? "text-destructive-text"
                  : cardLine.kind === "warning" ||
                      cardLine.kind === "overlap" ||
                      cardLine.kind === "conflict"
                    ? "text-available-text"
                    : "text-ink-3", // advisory — informational ink, never amber/red
            }
          : null;

  // "Add AP credit" (spec 007 §1b/§2b/§5c) — a subtle deep-link into the
  // credits dialog, shown alongside (a) an advisory line whose note plausibly
  // means "credit could cover this", or (b) a BLOCKED line whose unmet leaves
  // a known equivalency could satisfy — the falsely-blocked-on-AP freshman is
  // the target user, and a blocked card credit could fix must not dead-end.
  const showAddCreditAction =
    (cardLine?.kind === "advisory" && mentionsCredit(slotStatus.advisoryNotes[0] ?? "")) ||
    (cardLine?.kind === "blocked" &&
      creditCouldUnblock(slotStatus.unmetPrereqLeaves, CREDIT_EQUIVALENCIES));
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);

  const ariaStatus = isCompleted
    ? ", completed"
    : isInProgress
      ? ", in progress"
      : cardLine
        ? cardLine.kind === "blocked"
          ? `, blocked — ${cardLine.text}`
          : cardLine.kind === "warning"
            ? `, ${cardLine.text}`
            : cardLine.kind === "overlap"
              ? `, overlap — ${cardLine.text}`
              : cardLine.kind === "conflict"
                ? `, ${cardLine.text}`
                : `, advisory — ${cardLine.text}`
        : "";

  const ariaLabel = `${display.eyebrow} ${display.title}${ariaStatus}. ${
    armedCourse && canReceiveArmed
      ? `Press Enter to add ${armedCourse.subject} ${armedCourse.number} to this semester.`
      : "Press Enter for course details."
  }`;

  const reduceMotion = prefersReducedMotion();
  const ring = RING[visual];
  const ringColor = ring.ring;
  const catMeta = displayCategory ? CATEGORY_META[displayCategory] : null;

  return (
    <div
      ref={outerRef}
      data-placement={slot.id}
      data-course={placed?.id ?? slot.course_id ?? undefined}
      data-highlighted={isHighlighted ? "true" : undefined}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={onDragPointerDown}
      onMouseEnter={() => onChainHover(slot.id)}
      onMouseLeave={() => onChainHover(null)}
      onFocus={() => onChainHover(slot.id)}
      onBlur={() => onChainHover(null)}
      className={cn(
        "drag-source group relative flex min-h-[104px] w-full flex-col rounded-lg text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        showAsEmpty
          ? "border-[1.5px] border-dashed border-line-strong bg-transparent"
          : cn(
              // 2px status ring chassis around a --surface body.
              "p-0.5 cursor-grab active:cursor-grabbing",
              "shadow-[var(--card-rest-shadow)] transition-shadow duration-200 hover:shadow-md",
              highlightForArm && "ring-1 ring-drop cursor-pointer"
            ),
        // Still-needed highlight (spec 014 §D2) — wins over the arm ring.
        isHighlighted && "ring-[3px] ring-drop ring-offset-2 ring-offset-canvas"
      )}
      style={{
        ...(showAsEmpty ? null : { background: ringColor }),
        // Hidden while the drag hovers an insertion point — the column's
        // outline takes its place; the node stays mounted (DragGhost
        // re-measures it for a failed drop's return-home).
        ...(dragFace === "hidden" ? { display: "none" } : null),
      }}
    >
      {showAsEmpty ? (
        /* In-flight placeholder — the course is travelling (drag) or armed. */
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-3 text-center opacity-60">
          <span className="num text-[8.5px] font-medium uppercase tracking-[.09em] text-ink-4">
            {display.eyebrow}
          </span>
          <p className="line-clamp-2 t-meta text-ink-3">{display.title}</p>
        </div>
      ) : (
        <>
          {/* Live border — two conic glint layers clipped inside the 2px ring:
              slow layer always spinning, fast layer fades in on hover (the
              glint spins ~4x faster under the cursor). Reduced motion → the
              static ring color alone. */}
          {!reduceMotion && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: conicGlint(ring.glint),
                  animation: "border-spin 5.5s linear infinite",
                }}
              />
              <div
                className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background: conicGlint(ring.glint),
                  animation: "border-spin 1.3s linear infinite",
                }}
              />
            </div>
          )}

          {/* Blocked halo — the destructive glow/ring tokens (extract §6). */}
          {visual === "blocked" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg"
              style={{
                boxShadow:
                  "0 0 0 3px var(--destructive-ring), 0 0 12px 1px var(--destructive-glow)",
              }}
            />
          )}

          {/* One-shot ring sweep on manual state change (ring-sweep-a/b). */}
          {fx.sweeping && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg border-2"
              style={{
                borderColor: ring.glint,
                transformOrigin: "left",
                animation: sweepAnim,
              }}
              onAnimationEnd={() => setFx((f) => ({ ...f, sweeping: false }))}
            />
          )}

          {/* Body — --surface, radius 6, reserves 30px at the bottom for the
              meta row + corner pill. */}
          <div className="relative flex flex-1 flex-col gap-[5px] overflow-hidden rounded-md bg-surface px-[10px] pb-[30px] pt-[9px]">
            {/* Eyebrow row: category dot · code · status glyph · credits pill */}
            <div className="flex items-center gap-[5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 flex-none rounded-full",
                    catMeta ? catMeta.dot : "bg-line-strong"
                  )}
                />
                <span className="truncate font-sans text-[11px] font-extrabold uppercase tracking-[.07em] text-ink">
                  {display.eyebrow}
                </span>
              </span>
              <span className="ml-auto flex flex-none items-center gap-[5px]">
                <StatusGlyph visual={visual} popAnim={popAnim} />
                {display.credits && (
                  <span className="num flex-none rounded-pill border border-line bg-surface-2 px-[7px] text-[8.5px] font-medium leading-[1.5] text-ink-2">
                    {display.credits} cr
                  </span>
                )}
              </span>
            </div>

            {/* Title + (bucket) chosen-course code + status line */}
            <p
              className={cn(
                "line-clamp-2 font-sans text-[12px] font-semibold leading-[1.38] text-ink",
                isCompleted && "text-complete-text"
              )}
            >
              {display.title}
            </p>
            {statusLine && (
              <p className={cn("text-[9.5px] font-bold", statusLine.className)}>
                {statusLine.text}
              </p>
            )}
            {/* Requirement attribution (spec 014 §D1) — what this course counts
                toward, from majorMatch via useRequirementProgress. Nothing
                renders when it counts toward nothing (or before it loads). */}
            {attribution && attribution.length > 0 && (
              <p
                data-attribution
                className="truncate text-[9px] font-semibold text-ink-3"
                title={`Counts toward ${attribution.join(", ")}`}
              >
                <span aria-hidden="true">↳ </span>
                <span className="sr-only">Counts toward </span>
                {attribution.join(" · ")}
              </p>
            )}
            {showAddCreditAction && (
              <button
                onClick={(e) => { e.stopPropagation(); setCreditsOpen(true); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="-mt-1 w-fit t-label text-drop-text opacity-80 transition-opacity hover:opacity-100"
              >
                Add AP credit
              </button>
            )}

            {/* Near-horizon instructor line (spec 012 §2) — the primary section's
                instructor(s), a quiet single line. "Should I take this right now"
                data, only ever shown for the near, offered-this-term column. */}
            {nearInstructorLine && (
              <p className="truncate text-[9px] text-ink-3" title={nearInstructorLine}>
                {nearInstructorLine}
              </p>
            )}
            {/* Near column, but this course's roster slug is KNOWN to differ
                from the target — the honest proxy line (the sync's `roster`
                field, never the numeric roster_id; silent when roster is null). */}
            {showNotOffered && (
              <p className="text-[9px] font-medium text-ink-4">not offered this term</p>
            )}
            {/* Quiet "varies by instructor" badge (spec 013 §3d) — the only
                professor signal on the card; title-attributed, static. Its full
                timeline lives in the detail panel. */}
            {showVariesBadge && (
              <div className="flex">
                <VariesByInstructorBadge />
              </div>
            )}

            {/* Bottom meta row: category tag · PRE counter · unlocks count · term chips */}
            <div className="absolute bottom-1.5 left-[10px] right-[10px] flex items-center gap-1.5">
              <CategoryTag category={displayCategory} />
              <PreCounter progress={preProgress} />
              {unlocksN > 0 && (
                <span
                  className="num flex-none text-[8.5px] font-medium text-ink-3"
                  title={`Unlocks ${unlocksN} later course${unlocksN === 1 ? "" : "s"}`}
                >
                  →{unlocksN}
                </span>
              )}
              {offered.length > 0 && (
                <span
                  className="num flex-none text-[8.5px] text-ink-4"
                  title={offered.map((t) => TERM_NAMES[t] ?? t).join(" · ")}
                >
                  {offered.join(" · ")}
                </span>
              )}
              {/* Near-horizon meeting chip + open-status dot (spec 012 §2) —
                  the primary section's pattern/time, and O→open / W→waitlist /
                  C→closed as a small title-attributed dot. */}
              {nearMeeting && (
                <span
                  className="num flex-none truncate text-[8.5px] text-ink-3"
                  title={`Meets ${nearMeeting}`}
                >
                  {nearMeeting}
                </span>
              )}
              {nearOpen && (
                <span
                  aria-hidden="true"
                  title={openStatusWord(nearSection?.openStatus) ?? undefined}
                  className="h-2 w-2 flex-none rounded-full"
                  style={{
                    background:
                      nearOpen === "open"
                        ? "var(--complete)"
                        : nearOpen === "waitlist"
                          ? "var(--available)"
                          : "var(--destructive)",
                  }}
                />
              )}
            </div>

            <CornerActions
              courseLabel={display.eyebrow}
              isCompleted={isCompleted}
              isInProgress={isInProgress}
              moveOptions={moveOptions}
              onComplete={() => { triggerStatusFx(); handleToggleCompleted(); }}
              onInProgress={() => { triggerStatusFx(); toggleInProgress(slot.id); }}
              onClearStatus={() => { triggerStatusFx(); handleClearStatus(); }}
              onMoveTo={handleMoveTo}
              onMoveTop={handleMoveTop}
              onRemove={() => { disarm(); removePlacement(slot.id); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
