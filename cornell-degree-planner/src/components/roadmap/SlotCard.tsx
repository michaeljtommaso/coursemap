import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Clock,
  Undo2,
  Minus,
  Trash2,
  Eraser,
  MoreHorizontal,
  Plus,
  TriangleAlert,
  Info,
} from "lucide-react";
import { animate, spring } from "animejs";
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
import { CATEGORY_META } from "@/lib/planner/slotCategory";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { mergeEffectiveSlots } from "@/hooks/useEffectiveSlots";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { dragState } from "@/lib/drag/dragState";
import { slotCredits, formatCredits, slotSearchSeed } from "@/lib/planner/semesters";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * SlotCard — the signature component of the roadmap (spec 004 §2, engine
 * surfacing spec 006 §B.3, card direction 11 · claude-design-2026-07-11).
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
 *      Clear / overflow "⋯" (Waive + structural actions).
 *
 * Display precedence (spec 007 §1b, extending spec 006 §B.1):
 *   Complete > In progress > Waived > Blocked (red) > Warning (amber) >
 *   Advisory (quiet ink) > Available.
 */

/** The card's resolved visual state — precedence-collapsed from the manual
 *  states (plan doc) and the derived states (engine). */
type CardVisual =
  | "completed"
  | "in-progress"
  | "waived"
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
  waived: { ring: "var(--waived-bd)", glint: "var(--waived)", badge: "var(--waived)" },
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
        : visual === "waived"
          ? Minus
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
          : slot.kind === "attribute"
            ? (slot.pattern_title ?? "Requirement")
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
  if (slot.kind === "attribute") {
    // Attribute slots (spec 010 §2) REUSE patternTitle as their label, rendered
    // exactly the way a pattern slot's title is — there is no course code.
    return {
      eyebrow: "Requirement",
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
 * out, remove the slot). Rendered through a portal so the card body's
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

/** Corner-morph actions (direction 11) — a bottom-right 24px "⋯" pill that
 *  widens on hover/focus-within (`width .22s cubic-bezier(.3,1.2,.4,1)`,
 *  slight overshoot) into ✓ Complete / ◷ In progress / ✕ Clear (only when a
 *  manual state is set) / ⋯ overflow. Touch (`hover:none`) keeps the pill
 *  expanded; keyboard focus expands it too. Same handlers/semantics as the
 *  old ActionRow — real buttons, keyboard reachable, aria copy preserved. */
function CornerActions({
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
          ? "group-hover:w-[116px] group-focus-within:w-[116px] [@media(hover:none)]:w-[116px]"
          : "group-hover:w-[90px] group-focus-within:w-[90px] [@media(hover:none)]:w-[90px]"
      )}
    >
      <span
        aria-hidden="true"
        className="absolute text-[11px] font-bold leading-none text-ink-3 transition-opacity duration-[120ms] group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0"
      >
        ⋯
      </span>
      <div
        className={cn(
          "pointer-events-none flex gap-px opacity-0",
          "transition-opacity delay-[60ms] duration-150",
          "group-hover:pointer-events-auto group-hover:opacity-100",
          "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
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
            aria-label="Clear this slot's status"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <CardOverflowMenu
          isWaived={isWaived}
          placed={placed}
          onWaive={onWaive}
          onClear={onClear}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}

const NO_PROGRESS: PrereqProgress = { met: 0, total: 0 };
const NO_SLOTS: ProgramSlotWithData[] = [];

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
    slotOverrides,
    customSlots,
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

  // ── PRE counter (direction 11): met/total of top-level prereq requirements,
  //    over the SAME pools the engine reads (semesterPrereqPools over the plan's
  //    effective slots, credit profile included — the engine folds the credit
  //    pool into every evaluate() call, so the counter must too or a credit-met
  //    card would read "PRE 0/1 ✕" while its ring reads met) so the counter can
  //    never disagree with `blocked`. The expr comes from the full course doc
  //    (snapshots carry null → "PRE —" until the doc lands, exactly when the
  //    engine reads neutral too). ──────
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { getProgramData } = useProgramContext();
  const { creditProfile } = useAuth();
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);
  const baseProgramSlots =
    (selectedProgramId ? getProgramData(selectedProgramId)?.slots : undefined) ?? NO_SLOTS;
  // Detail doc wins WHOLESALE when cached (mirrors enrichCourse), else the
  // snapshot's own expr — so this reads exactly what the engine evaluated.
  const cardDoc = effectiveCourse
    ? (courseDetails[effectiveCourse.id] ?? effectiveCourse)
    : null;
  const prereqExpr = cardDoc?.prereq_expr ?? null;
  const preProgress = useMemo<PrereqProgress>(() => {
    if (!prereqExpr) return NO_PROGRESS;
    const { effectiveSlots } = mergeEffectiveSlots(baseProgramSlots, slotOverrides, customSlots);
    const pools = semesterPrereqPools(
      effectiveSlots,
      completedSlotIds,
      slotSelections,
      selectedCourses,
      slot.suggested_semester,
      creditCourses
    );
    return prereqProgress(prereqExpr, {
      completedIds: pools.completedIds,
      completedCodes: pools.completedCodes,
      concurrentIds: pools.concurrentIds,
    });
  }, [
    prereqExpr,
    baseProgramSlots,
    slotOverrides,
    customSlots,
    completedSlotIds,
    slotSelections,
    selectedCourses,
    slot.suggested_semester,
    creditCourses,
  ]);

  // ── Display precedence (spec 007 §1b, extending spec 006 §B.1): manual
  //    states first, then derived — blocked > warning > advisory > available. ──
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
    prereqState: slotStatus.prereqState,
    advisoryNotes: slotStatus.advisoryNotes,
  });

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

  // ── State-change feedback (direction 11): when a manual state changes, the
  //    glyph pops (glyph-pop-a/b, alternating so consecutive changes retrigger)
  //    and the ring runs one sweep. Triggered from the action handlers (the
  //    prototype's `setStatus` sweep-counter pattern); reduced motion → none. ──
  const [fx, setFx] = useState<{ n: number; sweeping: boolean }>({ n: 0, sweeping: false });
  const triggerStatusFx = () => {
    if (prefersReducedMotion()) return;
    // The sweep overlay only exists on the ringed (filled) card; marking an
    // empty bucket pops nothing and must not leave a sweep pending.
    setFx((f) => ({ n: f.n + 1, sweeping: hasContent }));
  };
  const ab = fx.n % 2 ? "a" : "b";
  const popAnim = fx.n > 0 ? `glyph-pop-${ab} .45s cubic-bezier(.34,1.56,.64,1)` : null;
  const sweepAnim = `ring-sweep-${ab} .5s cubic-bezier(.2,0,.2,1)`;

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
      const r = outerRef.current?.getBoundingClientRect();
      const originRect = r
        ? { left: r.left, top: r.top, width: r.width, height: r.height }
        : null;
      const sourceEl = outerRef.current ?? null;
      if (placed) {
        dragState.start({
          courseId: placed.id,
          course: placed,
          sourceSlotId: slot.id,
          startX: e.clientX,
          startY: e.clientY,
          originRect,
          sourceEl,
        });
      } else {
        const d = getDisplay(slot, null);
        dragState.startSlotMove({
          slotId: slot.id,
          slotLabel: { eyebrow: d.eyebrow, title: d.title },
          startX: e.clientX,
          startY: e.clientY,
          originRect,
          sourceEl,
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

  // Plain-language status line under the title — the visible engine (triage
  // #10). Manual states win outright; otherwise defer to the tested
  // blocked > warning > overlap > advisory precedence (spec 007 §1b).
  const statusLine: { text: string; className: string } | null =
    visual === "in-progress"
      ? { text: "In progress", className: "text-drop-text" }
      : visual === "waived"
        ? { text: "Waived", className: "text-waived-text" }
        : visual === "completed"
          ? null
          : cardLine
            ? {
                text: cardLine.text,
                className:
                  cardLine.kind === "blocked"
                    ? "text-destructive-text"
                    : cardLine.kind === "warning" || cardLine.kind === "overlap"
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
      : isWaived
        ? ", waived"
        : cardLine
          ? cardLine.kind === "blocked"
            ? `, blocked — ${cardLine.text}`
            : cardLine.kind === "warning"
              ? `, ${cardLine.text}`
              : cardLine.kind === "overlap"
                ? `, overlap — ${cardLine.text}`
                : `, advisory — ${cardLine.text}`
          : "";

  const ariaLabel = placed
    ? `${display.metaCode ?? display.eyebrow} ${display.title}${ariaStatus}. Press Enter for course details.`
    : hasContent
      ? `${display.eyebrow} ${display.title}${ariaStatus}. Press Enter for course details.`
      : `${display.title}, open slot${armedCourse ? `. Press Enter to place ${armedCourse.subject} ${armedCourse.number}.` : ""}`;

  const reduceMotion = prefersReducedMotion();
  const ring = RING[visual];
  // Drop target / armed-receive tint the chassis blue like the old border did.
  const ringColor = isDropTarget && !showAsEmpty ? "var(--drop)" : ring.ring;
  const catMeta = slot.category ? CATEGORY_META[slot.category] : null;

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
        "group relative flex min-h-[104px] w-full flex-col rounded-lg text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
        showAsEmpty
          ? cn(
              // Empty slot — dashed, quiet, centered (direction 11 empty treatment).
              "border-[1.5px] border-dashed border-line-strong bg-transparent cursor-grab active:cursor-grabbing transition-colors",
              hasStatusMark && "border-solid",
              hasStatusMark && visual === "completed" && "border-complete/60",
              hasStatusMark && visual === "in-progress" && "border-drop/60",
              hasStatusMark && visual === "waived" && "border-waived/60",
              highlightForArm && "border-solid border-drop bg-drop-tint/60 cursor-pointer",
              isDropTarget && "border-solid border-drop bg-drop-tint"
            )
          : cn(
              // Filled card — 2px status ring chassis around a --surface body.
              "p-0.5 cursor-grab active:cursor-grabbing",
              "shadow-[var(--card-rest-shadow)] transition-shadow duration-200 hover:shadow-md",
              highlightForArm && "ring-1 ring-drop cursor-pointer"
            ),
        isSlotMoving && "opacity-30"
      )}
      style={showAsEmpty ? undefined : { background: ringColor }}
    >
      {isDropTarget && showAsEmpty ? (
        <div className="flex flex-1 items-center justify-center py-4">
          <span className="t-body font-medium text-drop-text">Drop it here</span>
        </div>
      ) : showAsEmpty ? (
        /* Empty slot — centered uppercase mono bucket label, dashed border,
           quiet. Keeps the bucket identity + "＋ Find a class" invite. A manual
           mark (completed / in-progress / waived) on an empty bucket (spec 005
           §11 — "my FWS is done, don't care which one") shows a solid status
           border + its status line. */
        <>
          <div
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-3 text-center",
              highlightForArm || hasStatusMark ? "opacity-90" : "opacity-60"
            )}
          >
            <span className="num text-[8.5px] font-medium uppercase tracking-[.09em] text-ink-4">
              {display.eyebrow}
              {display.credits ? ` · ${display.credits} cr` : ""}
            </span>
            <p className={cn("line-clamp-2 t-meta", isCompleted ? "text-complete-text" : "text-ink-3")}>
              {display.title}
            </p>
            {slot.category && (
              <div className="flex justify-center">
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
                onClick={(e) => {
                  e.stopPropagation();
                  // Attribute slots (spec 010 §2) open the drawer with an
                  // attribute filter + removable chip instead of a text query.
                  const filters =
                    slot.kind === "attribute" && slot.attribute_match
                      ? {
                          attribute: slot.attribute_match,
                          attributeLabel: slot.pattern_title ?? "Requirement",
                        }
                      : undefined;
                  requestCatalogSearch(slotSearchSeed(slot), filters);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="mt-0.5 inline-flex w-fit items-center gap-1 rounded text-[11px] font-semibold text-drop-text opacity-80 transition-opacity hover:opacity-100"
                aria-label={`Find a class for ${display.title}`}
              >
                <Plus className="h-2.5 w-2.5" />
                Find a class
              </button>
            )}
          </div>
          <CornerActions
            isCompleted={isCompleted}
            isInProgress={isInProgress}
            isWaived={isWaived}
            placed={null}
            onComplete={() => { triggerStatusFx(); handleToggleCompleted(); }}
            onInProgress={() => { triggerStatusFx(); toggleInProgress(slot.id); }}
            onClearStatus={() => { triggerStatusFx(); handleClearStatus(); }}
            onWaive={() => { triggerStatusFx(); toggleWaived(slot.id); }}
            onClear={() => {}}
            onRemove={() => { disarm(); removeSlot(slot.id); }}
          />
        </>
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
          <div
            className={cn(
              "relative flex flex-1 flex-col gap-[5px] overflow-hidden rounded-md bg-surface px-[10px] pb-[30px] pt-[9px]",
              isDropTarget && "bg-drop-tint"
            )}
          >
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
            {display.metaCode && (
              <p className="num text-[8.5px] text-ink-3">{display.metaCode}</p>
            )}
            {statusLine && (
              <p className={cn("text-[9.5px] font-bold", statusLine.className)}>
                {statusLine.text}
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

            {/* Bottom meta row: category tag · PRE counter · term chips */}
            <div className="absolute bottom-1.5 left-[10px] right-[10px] flex items-center gap-1.5">
              <CategoryTag category={slot.category} />
              <PreCounter progress={preProgress} />
              {offered.length > 0 && (
                <span
                  className="num flex-none text-[8.5px] text-ink-4"
                  title={offered.map((t) => TERM_NAMES[t] ?? t).join(" · ")}
                >
                  {offered.join(" · ")}
                </span>
              )}
            </div>

            <CornerActions
              isCompleted={isCompleted}
              isInProgress={isInProgress}
              isWaived={isWaived}
              placed={placed}
              onComplete={() => { triggerStatusFx(); handleToggleCompleted(); }}
              onInProgress={() => { triggerStatusFx(); toggleInProgress(slot.id); }}
              onClearStatus={() => { triggerStatusFx(); handleClearStatus(); }}
              onWaive={() => { triggerStatusFx(); toggleWaived(slot.id); }}
              onClear={() => { disarm(); clearSlot(slot.id); }}
              onRemove={() => { disarm(); removeSlot(slot.id); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
