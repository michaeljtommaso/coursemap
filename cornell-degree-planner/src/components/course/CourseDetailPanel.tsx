import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, ArrowLeft, Check, Clock, Minus, Undo2, MapPin } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useSlotStatus } from "@/hooks/useSlotStatus";
import { CATEGORY_META, subjectCategory } from "@/lib/planner/slotCategory";
import { formatCredits, semesterLabel } from "@/lib/planner/semesters";
import { semesterPrereqPools } from "@/lib/planner/computeSlotStatusMap";
import { isVacuousPrereq } from "@/lib/planner/prereqTree";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import { evaluate } from "@/lib/planner/satisfies";
import { overlapMessage, conflictMessage, mentionsCredit, creditCouldUnblock } from "@/lib/planner/statusLine";
import { CREDIT_EQUIVALENCIES } from "@/data/credit-equivalencies";
import { useHorizonMap } from "@/hooks/useHorizonMap";
import {
  sectionInstructorNames,
  formatMeetingChip,
  openStatusWord,
  gradingBasisAllowsSU,
  componentNote,
} from "@/lib/planner/sections";
import { prefersReducedMotion } from "@/lib/motion";
import { PrereqTree } from "@/components/course/PrereqTree";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import { useReviews } from "@/contexts/ReviewsProvider";
import { variesByInstructor } from "@/lib/planner/reviews";
import {
  ProfessorRatingLine,
  InstructorTimeline,
  VariesByInstructorBadge,
} from "@/components/reviews/ProfessorReview";
import type { CourseReviewView } from "@/services/reviews";
import type { PrereqPools } from "@/lib/planner/prereqTree";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";

/**
 * CourseDetailPanel (spec 006 §D4, restyled per card direction 11's side-peek —
 * claude-design-2026-07-11) — a right side-peek reusing RightSidebar's slide-in
 * idiom (480px, anime.js translate, visual-only backdrop). Opened from a canvas
 * card it slides over the canvas; from a catalog chip it layers over the drawer
 * (higher z) with a back affordance.
 *
 * Content is UNIQUE PER STATUS (presentation-only; everything derives from the
 * plan state + the unified useSlotStatus engine — no new fetching):
 *   completed / in-progress / waived → tinted status badge in the header
 *     (waived adds the "satisfied without a recorded course" bucket note);
 *   blocked → red status line ("Needs CS 2110 first") + the prereq chip tree
 *     with unmet red chips and placement notes ("planned — Fall of year 2");
 *   warning → amber "offered in …" line + emphasized offered-terms chip;
 *   available → met chips, or the no-prereqs fallback when vacuous.
 * Empty slots never open the panel (SlotCard only opens it with a course).
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

/** Mono uppercase section label — the extract's DESCRIPTION / PREREQUISITES
 *  treatment (9.5px, .09em tracking, --text-4). */
const SECTION_LABEL =
  "font-mono text-[9.5px] font-semibold uppercase tracking-[0.09em] text-ink-4";

const ACTION_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-[11.5px] font-semibold transition-colors";

/** "Needs CS 2110 first" — same copy rules as SlotCard's status line. */
function blockedLine(leaves: string[]): string {
  if (leaves.length === 0) return "Prerequisites not met";
  if (leaves.length === 1) return `Needs ${leaves[0]} first`;
  if (leaves.length === 2) return `Needs ${leaves[0]} or ${leaves[1]} first`;
  return `Needs ${leaves[0]}, ${leaves[1]} …`;
}

/** "Usually offered in Fall only" — same copy rules as SlotCard's status line. */
function offeredLine(offered: string[]): string {
  const names = offered.map((t) => TERM_NAMES[t] ?? t);
  if (names.length === 0) return "Check when this is offered";
  if (names.length === 1) return `Usually offered in ${names[0]} only`;
  const last = names[names.length - 1];
  return `Usually offered in ${names.slice(0, -1).join(", ")} or ${last}`;
}

type PanelVisual = "completed" | "in-progress" | "waived" | "blocked" | "warning" | "available";

export function CourseDetailPanel({ slots }: { slots: ProgramSlotWithData[] }) {
  const detailCourse = usePlannerStore((s) => s.detailCourse);
  const detailOverDrawer = usePlannerStore((s) => s.detailOverDrawer);
  const close = usePlannerStore((s) => s.closeCourseDetail);
  const armCourse = usePlannerStore((s) => s.armCourse);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);

  const { courseDetails, ensureCourseDetails } = useCatalogContext();
  const { creditProfile } = useAuth();
  const {
    slotSelections,
    selectedCourses,
    completedSlotIds,
    waivedSlotIds,
    inProgressSlotIds,
    toggleCompleted,
    toggleWaived,
  } = usePlan();

  // Unified engine status (spec 006 §B.2) — the same map the canvas cards read,
  // so the panel's blocked/warning presentation never disagrees with the card.
  // useSlotStatus already folds the credit profile into computeSlotStatusMap
  // (Unit 7B/7D), so a PLACED course's slotStatus is already credit-aware.
  const { statusMap } = useSlotStatus(slots);

  // Credit pool (spec 007 §2/§3, Unit 7C2) — folded into the tree's OWN pools
  // below (semesterPrereqPools' new creditCourses param) so a course browsed
  // from the catalog (not yet placed — no slotStatus) still agrees with what
  // the card would show once placed.
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const hasInitRef = useRef(false);
  // Retain the last course through the close animation so the panel doesn't
  // blank mid-slide-out.
  const lastCourseRef = useRef<Course | null>(null);
  if (detailCourse) lastCourseRef.current = detailCourse;
  const course = detailCourse ?? lastCourseRef.current;

  const open = detailCourse !== null;

  // Fetch the full doc (description / prereq / coreq / offered) for the open id.
  useEffect(() => {
    if (detailCourse) ensureCourseDetails([detailCourse.id]);
  }, [detailCourse, ensureCourseDetails]);

  // Slide-in / slide-out — the extract's feel: translateX(510px)→0 over .34s
  // with a slight spring overshoot (cubic-bezier(.22,1.12,.36,1) equivalent),
  // scrim fading .25s. Reduced-motion (and first paint) snap instantly.
  useEffect(() => {
    if (!panelRef.current || !backdropRef.current) return;
    const isFirst = !hasInitRef.current;
    hasInitRef.current = true;
    const instant = isFirst || prefersReducedMotion();
    if (open) {
      backdropRef.current.style.display = "block";
      animate(backdropRef.current, { opacity: [0, 1], duration: instant ? 0 : 250, ease: "out(2)" });
      if (instant) {
        animate(panelRef.current, { x: 0, duration: 0 });
      } else {
        // bounce 0.08 (was 0.18): the bigger overshoot oscillated visibly on
        // the 480px panel and read as jitter.
        animate(panelRef.current, { x: 0, ease: spring({ bounce: 0.08, duration: 340 }) });
      }
    } else {
      animate(backdropRef.current, {
        opacity: [1, 0],
        duration: instant ? 0 : 200,
        ease: "in(2)",
        onComplete() {
          if (backdropRef.current) backdropRef.current.style.display = "none";
        },
      });
      animate(panelRef.current, { x: 510, duration: instant ? 0 : 300, ease: "in(2)" });
    }
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const full = course ? (courseDetails[course.id] ?? course) : null;

  // The slot this course occupies in the current plan (user pick or a fixed
  // template slot), for the "counts toward" line + complete/waive actions.
  const matchingSlot = useMemo<ProgramSlotWithData | null>(() => {
    if (!course) return null;
    const placed = slots.find((s) => slotSelections[s.id] === course.id);
    if (placed) return placed;
    return (
      slots.find(
        (s) => s.kind === "course" && s.courses?.id === course.id && !slotSelections[s.id]
      ) ?? null
    );
  }, [course, slots, slotSelections]);

  // Satisfaction pools for the prereq/coreq trees. When the course is PLACED
  // (matchingSlot), mirror computeSlotStatusMap's semantics exactly via
  // semesterPrereqPools — prereqs read a strictly-earlier-semester completed
  // pool, coreqs (and {concurrent} nodes) a same-or-earlier pool — so a leaf
  // here never disagrees with the card's blocked state. When it ISN'T placed
  // (directory browsing), there's no target semester and no ordering to apply:
  // keep the optimistic "does my plan cover this anywhere" pool of every
  // placed course.
  const pools = useMemo<{ prereq: PrereqPools; coreq: PrereqPools }>(() => {
    if (matchingSlot) {
      const p = semesterPrereqPools(
        slots,
        completedSlotIds,
        slotSelections,
        selectedCourses,
        matchingSlot.suggested_semester,
        creditCourses
      );
      return {
        prereq: { completedIds: p.completedIds, completedCodes: p.completedCodes, concurrentIds: p.concurrentIds },
        coreq: { completedIds: p.concurrentIds, completedCodes: p.concurrentCodes, concurrentIds: p.concurrentIds },
      };
    }
    const ids = new Set<string>(creditCourses.ids);
    const codes = new Set<string>(creditCourses.codes);
    const add = (c: Course | null | undefined) => {
      if (!c) return;
      ids.add(c.id);
      codes.add(`${c.subject} ${c.number}`);
    };
    for (const s of slots) {
      const sel = slotSelections[s.id];
      if (sel) add(selectedCourses[sel]);
      else if (s.kind === "course") add(s.courses);
    }
    const all: PrereqPools = { completedIds: ids, completedCodes: codes, concurrentIds: ids };
    return { prereq: all, coreq: all };
  }, [matchingSlot, slots, slotSelections, selectedCourses, completedSlotIds, creditCourses]);

  // Placement notes for prereq chips ("planned — Fall of year 2", "completed")
  // — presentation-only derivation from plan state the panel already holds;
  // season/year via the existing semesterLabel helper.
  const placementNoteOf = useMemo(() => {
    const byCourseId = new Map<string, { sem: number; completed: boolean; inProgress: boolean }>();
    const completed = new Set(completedSlotIds);
    const inProgress = new Set(inProgressSlotIds);
    for (const s of slots) {
      const sel = slotSelections[s.id];
      const c = sel ? (selectedCourses[sel] ?? null) : s.kind === "course" ? s.courses : null;
      if (!c) continue;
      const info = {
        sem: s.suggested_semester,
        completed: completed.has(s.id),
        inProgress: inProgress.has(s.id),
      };
      const prev = byCourseId.get(c.id);
      if (!prev || (info.completed && !prev.completed)) byCourseId.set(c.id, info);
    }
    return (id: string): string | null => {
      const info = byCourseId.get(id);
      if (info) {
        if (info.completed) return "completed";
        if (info.inProgress) return "in progress";
        const label = semesterLabel(info.sem, null);
        return `planned — ${label.primary} of year ${Math.ceil(info.sem / 2)}`;
      }
      // Credit-satisfied placement (spec 007 §2/§3, Unit 7C2) — a leaf that
      // isn't placed/completed anywhere in the plan but IS covered by a
      // synthetic credit course reads as satisfied by the student's own
      // AP/transfer credit, not a silent "met" with no explanation.
      if (creditCourses.ids.has(id)) return "your AP/transfer credit";
      return null;
    };
  }, [slots, slotSelections, selectedCourses, completedSlotIds, inProgressSlotIds, creditCourses]);

  // Category: the matching slot's category, else derived from the subject.
  const category: SlotCategory | null = matchingSlot?.category ?? (course ? subjectCategory(course.subject) : null);

  // Major-relevance line (local signal, same inputs Major Match uses): whether
  // this course is a named requirement of THIS program, or fits an elective rule.
  const relevance = useMemo<string | null>(() => {
    if (!course) return null;
    const isRequired = slots.some((s) => s.kind === "course" && s.courses?.id === course.id);
    if (isRequired) return "A required course in this major.";
    const [subject, numStr] = course.id.split("-");
    const num = parseInt(numStr ?? "", 10);
    const fitsElective = slots.some((s) => {
      if (s.kind !== "elective" || !s.elective_groups) return false;
      const rule = s.elective_groups.qualifying_rule;
      if (rule.type === "open") return true;
      if (rule.type === "level") return rule.subject === subject && !Number.isNaN(num) && num >= rule.min_number;
      if (rule.type === "outside") return !rule.exclude_subjects.includes(subject);
      return false;
    });
    return fitsElective ? "Could count toward an elective in this major." : null;
  }, [course, slots]);

  const isCompleted = matchingSlot ? completedSlotIds.includes(matchingSlot.id) : false;
  const isWaived = matchingSlot ? waivedSlotIds.includes(matchingSlot.id) : false;
  const isInProgress = matchingSlot ? inProgressSlotIds.includes(matchingSlot.id) : false;
  const slotStatus = matchingSlot ? statusMap[matchingSlot.id] : undefined;

  // Same display precedence as SlotCard (spec 006 §B.1):
  // Complete > In progress > Waived > Blocked > Warning > Available.
  const visual: PanelVisual = !matchingSlot
    ? "available"
    : isCompleted
      ? "completed"
      : isInProgress
        ? "in-progress"
        : isWaived
          ? "waived"
          : slotStatus?.blocked
            ? "blocked"
            : slotStatus?.offeredOk === false
              ? "warning"
              : "available";

  const credits = full ? formatCredits({ min: full.credits_min, max: full.credits_max }) : null;
  const offered = full?.offered ?? [];
  const offeredText = offered.map((t) => TERM_NAMES[t] ?? t).join(" · ");
  const catMeta = category ? CATEGORY_META[category] : null;

  const hasPrereq = !!full?.prereq_expr && !isVacuousPrereq(full.prereq_expr);
  const hasCoreq = !!full?.coreq_expr && !isVacuousPrereq(full.coreq_expr);

  // Advisory notes when the course ISN'T placed (matchingSlot null — directory
  // browsing has no slotStatus to read from). Uses the SAME pools the tree
  // renders from (credit already unioned in via semesterPrereqPools above),
  // so a browsed course's notes agree with what the card would show once
  // placed (spec 007 §3 — the C1 bug class this spec fixes). Plain (not
  // memoized) — cheap tree walk, and matches hasPrereq/hasCoreq just above.
  const browsingAdvisoryNotes: string[] =
    matchingSlot || !full
      ? []
      : [
          ...new Set([
            ...(full.prereq_expr
              ? evaluate(full.prereq_expr, {
                  completedIds: pools.prereq.completedIds,
                  completedCodes: pools.prereq.completedCodes,
                  concurrentIds: pools.prereq.concurrentIds,
                }).advisoryNotes
              : []),
            ...(full.coreq_expr
              ? evaluate(full.coreq_expr, {
                  completedIds: pools.coreq.completedIds,
                  completedCodes: pools.coreq.completedCodes,
                  concurrentIds: pools.coreq.concurrentIds,
                }).advisoryNotes
              : []),
          ]),
        ];

  // Notes section (spec 007 §1b/§3/§4, Unit 7C2) — docNotes (prose the parser
  // couldn't turn into a node) + advisory notes (parser-stripped alternatives
  // still unsatisfied), deduped against each other. Placed courses read both
  // straight off slotStatus (the exact source the card uses); browsing falls
  // back to the course doc + the locally-evaluated advisory notes above.
  const docNotesForPanel = slotStatus ? slotStatus.docNotes : (full?.prereq_notes ?? []);
  const advisoryNotesForPanel = slotStatus ? slotStatus.advisoryNotes : browsingAdvisoryNotes;
  const noteLines: string[] = [];
  {
    const seen = new Set<string>();
    for (const n of [...docNotesForPanel, ...advisoryNotesForPanel]) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      noteLines.push(n);
    }
  }
  const noteMentionsCredit = noteLines.some(mentionsCredit);

  // Overlap callout (spec 007 §1b/§5) — placed courses only; overlaps are a
  // plan-wide, slot-scoped signal (there's no "would this conflict" answer
  // for a course browsed off-plan).
  const overlaps = slotStatus?.overlaps ?? [];

  // Time-horizon (spec 012 §2/§3/§6) — same shared source the card reads, so the
  // panel's near/far content never disagrees with the card. Scoped to a PLACED
  // course (matchingSlot): a browsed, unplaced course has no column, hence no
  // honest distance to claim.
  const { bySlot: horizonBySlot, targetSlug } = useHorizonMap(slots);
  const slotHz = matchingSlot ? horizonBySlot[matchingSlot.id] : undefined;
  const showSections = !!slotHz?.offeredThisTerm && (full?.sections.length ?? 0) > 0;

  // ── Reviews layer (spec 013 §3c/§3d) — the professor ratings + instructor
  //    history for the open course, via the ReviewsProvider seam. Under the
  //    NullAdapter every getCourseView resolves to null → nothing renders (the
  //    kill switch). Ratings are NEAR-HORIZON ONLY (guardrail 3), gated at the
  //    render site below; the varies badge is the expand entry to the timeline. ──
  const reviews = useReviews();
  const [courseReview, setCourseReview] = useState<CourseReviewView | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reviewCourseId = course?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) setHistoryOpen(false);
      if (!reviewCourseId) {
        if (!cancelled) setCourseReview(null);
        return;
      }
      const v = await reviews.getCourseView(reviewCourseId);
      if (!cancelled) setCourseReview(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewCourseId, reviews]);
  const showReviews =
    slotHz?.horizon === "near" && !!courseReview && courseReview.perProfessor.length > 0;
  const reviewsVary = courseReview ? variesByInstructor(courseReview.perProfessor) : false;
  // Far line only when the app can honestly claim distance (target configured);
  // without a target we can't say schedules are "announced closer" vs. omitted.
  const showFarLine = slotHz?.horizon === "far" && !!targetSlug;
  // Quiet "as of <date>" freshness stamp from the course doc's updatedAt — only
  // when it parses to a real date (the epoch-0 sentinel on snapshots is skipped).
  const asOfDate = (() => {
    const raw = full?.updated_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return null;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  })();

  const statusBadge:
    | { label: string; icon: ReactNode; className: string }
    | null =
    visual === "completed"
      ? {
          label: "Completed",
          icon: <Check className="h-3 w-3" />,
          className: "border-[var(--complete-bd)] bg-complete-tint text-complete-text",
        }
      : visual === "in-progress"
        ? {
            label: "In progress",
            icon: <Clock className="h-3 w-3" />,
            className: "border-[var(--drop-bd)] bg-drop-tint text-drop-text",
          }
        : visual === "waived"
          ? {
              label: "Waived",
              icon: <Minus className="h-3 w-3" />,
              className: "border-[var(--waived-bd)] bg-waived-tint text-waived-text",
            }
          : null;

  const navigate = useNavigate();
  const location = useLocation();

  const handlePlace = () => {
    if (!course) return;
    armCourse(course, null);
    close();
    // From /classes (or anywhere off the canvas) arming is invisible — land the
    // user on the roadmap with the armed course ready to place.
    if (location.pathname !== "/") navigate("/");
  };

  return (
    <>
      {/* Blocking scrim — unlike the catalog drawer's visual-only backdrop, the
          detail peek IS modal-ish: while it's open the background must not be
          clickable, and clicking anywhere outside slides the peek closed.
          stopPropagation on pointerdown keeps the click from also reaching the
          drawer's document-level outside-click listener, so closing the peek
          never yanks the drawer out from under it. Scrim color is the
          extract's rgb(15 23 42 / .35) — no scrim token exists yet. */}
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="fixed inset-0 z-[var(--z-detail-backdrop)] cursor-default bg-[rgb(15_23_42/0.35)]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={course ? `${course.subject} ${course.number} details` : "Course details"}
        // stopPropagation so RightSidebar's outside-click listener doesn't close
        // the drawer underneath while the peek is interacted with.
        onPointerDown={(e) => e.stopPropagation()}
        style={{ transform: "translateX(510px)", willChange: "transform" }}
        className="fixed inset-y-0 right-0 z-[var(--z-detail-panel)] flex w-[480px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-xl"
      >
        {course && full && (
          <>
            {/* Header block: mono code row · title · chip row · status line */}
            <div className="border-b border-line px-[22px] pb-4 pt-[18px]">
              <div className="flex items-center gap-2.5">
                {detailOverDrawer && (
                  <button
                    onClick={close}
                    className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    aria-label="Back to catalog"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <span className="font-mono text-xs tracking-[0.05em] text-ink-3">
                  {course.subject} {course.number}
                </span>
                {statusBadge && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[9.5px] font-bold",
                      statusBadge.className
                    )}
                  >
                    {statusBadge.icon}
                    {statusBadge.label}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  <FavoriteStar courseId={course.id} size="md" className="shrink-0" />
                  {!detailOverDrawer && (
                    <button
                      onClick={close}
                      className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                      aria-label="Close course details"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </span>
              </div>

              <h2 className="pt-1.5 t-headline">{full.title}</h2>

              {/* Chip row: credits pill (same treatment as the card's corner
                  badge, per Michael 2026-07-11) · category tag · offered terms */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
                {credits && (
                  <span className="num inline-flex items-center rounded-pill border border-line bg-surface-2 px-[9px] py-[2px] text-[10px] font-medium text-ink-2">
                    {credits} credits
                  </span>
                )}
                {catMeta && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-[5px] px-[7px] py-[2px] text-[10px] font-semibold",
                      catMeta.text,
                      catMeta.tint
                    )}
                  >
                    {catMeta.tag}
                  </span>
                )}
                {offered.length > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-[5px] border px-[7px] py-[2px] font-mono text-[10px]",
                      // Warning state emphasizes the offered terms (the thing
                      // that's wrong with the placement).
                      visual === "warning"
                        ? "border-[var(--available-bd)] bg-available-tint font-medium text-available-text"
                        : "border-line text-ink-3"
                    )}
                    title="Offered terms"
                  >
                    {offered.length === 1 ? `${offeredText} only` : offeredText}
                  </span>
                )}
              </div>

              {/* Status line — the extract's note treatment for engine states. */}
              {visual === "blocked" && slotStatus && (
                <>
                  <p className="pt-2 text-[10.5px] font-bold text-destructive-text">
                    {blockedLine(slotStatus.unmetPrereqLeaves)}
                  </p>
                  {/* Same predicate as SlotCard (spec 007 §2b): a blocked
                      course whose unmet leaves a known equivalency could
                      satisfy offers the credit deep-link, not a dead end. */}
                  {creditCouldUnblock(slotStatus.unmetPrereqLeaves, CREDIT_EQUIVALENCIES) && (
                    <button
                      onClick={() => setCreditsOpen(true)}
                      className="mt-1 t-label text-drop-text opacity-80 transition-opacity hover:opacity-100"
                    >
                      Add AP credit
                    </button>
                  )}
                </>
              )}
              {visual === "warning" && (
                <p className="pt-2 text-[10.5px] font-bold text-available-text">
                  {offeredLine(offered)}
                </p>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-[22px] py-5">
              {/* Waived-bucket note (extract: requirement satisfied without a
                  recorded course). */}
              {visual === "waived" && (
                <div className="rounded-md border border-[var(--waived-bd)] bg-waived-tint px-3 py-2.5">
                  <p className="t-body text-waived-text">
                    This requirement was waived — it counts as satisfied without a
                    recorded course.
                  </p>
                </div>
              )}

              {/* Far-horizon calm line (spec 012 §3) — the absence of an
                  instructor/schedule is a FEATURE, and the copy says so. Only
                  when a target is configured (else the app can't claim distance). */}
              {showFarLine && (
                <p className="t-body text-ink-3">
                  Instructors and schedules are announced closer to the semester.
                </p>
              )}

              {relevance && <p className="t-body text-ink-2">{relevance}</p>}

              {matchingSlot && (
                <div className="flex items-start gap-1.5 rounded-md border border-line bg-surface-2/50 px-2.5 py-2">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-ink-3" />
                  <p className="t-body text-ink-2">
                    Counts toward{" "}
                    <span className="font-semibold text-ink">
                      {matchingSlot.kind === "elective" && matchingSlot.elective_groups
                        ? matchingSlot.elective_groups.name
                        : matchingSlot.kind === "pattern"
                          ? matchingSlot.pattern_title ?? matchingSlot.pattern ?? "a requirement"
                          : "this requirement"}
                    </span>{" "}
                    in your plan.
                  </p>
                </div>
              )}

              {full.description && (
                <div>
                  <p className={cn("mb-1.5", SECTION_LABEL)}>Description</p>
                  <p className="t-body leading-relaxed text-ink-2">{full.description}</p>
                </div>
              )}

              {/* Overlap callout (spec 007 §1b/§5) — amber, matching the
                  waived-bucket callout idiom above. Advisory tone: this is a
                  "heads up," never a block. */}
              {overlaps.length > 0 && (
                <div className="rounded-md border border-[var(--available-bd)] bg-available-tint px-3 py-2.5">
                  <p className="t-body text-available-text">{overlapMessage(overlaps)}</p>
                </div>
              )}

              {/* Near-horizon time conflict (spec 012 §4) — amber, matching the
                  overlap callout idiom. Advisory, never blocking; carries the
                  honest caption that only the main lecture times were compared. */}
              {slotHz?.conflictWith && (
                <div className="rounded-md border border-[var(--available-bd)] bg-available-tint px-3 py-2.5">
                  <p className="t-body text-available-text">{conflictMessage(slotHz.conflictWith)}</p>
                  <p className="mt-1 text-[10px] leading-snug text-available-text/80">
                    based on the main lecture times — other sections may differ
                  </p>
                </div>
              )}

              {/* Near-horizon Sections block (spec 012 §2) — every section for
                  the active roster: code, instructor(s), meeting, open status,
                  S/U availability, extra components. Only when the course is
                  offered in the enrollment term (rosterId === target). */}
              {showSections && full && (
                <div>
                  <p className={cn("mb-2", SECTION_LABEL)}>Sections</p>
                  <div className="flex flex-col gap-2.5">
                    {full.sections.map((s, i) => {
                      const names = sectionInstructorNames(s);
                      const meeting = formatMeetingChip(s);
                      const openWord = openStatusWord(s.openStatus);
                      const suNote = gradingBasisAllowsSU(s.gradingBasis);
                      const compNote = componentNote(s.components);
                      return (
                        <div key={i} className="rounded-md border border-line bg-surface-2/40 px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10.5px] font-medium text-ink">{s.code}</span>
                            {openWord && (
                              <span className="text-[9.5px] font-semibold text-ink-3">{openWord}</span>
                            )}
                            {suNote && (
                              <span className="rounded-pill border border-line px-1.5 text-[9px] text-ink-3">
                                S/U available
                              </span>
                            )}
                          </div>
                          {names.length > 0 && (
                            <p className="mt-0.5 t-body text-ink-2">{names.join(", ")}</p>
                          )}
                          {meeting && (
                            <p className="num mt-0.5 text-[10.5px] text-ink-3">{meeting}</p>
                          )}
                          {compNote && (
                            <p className="mt-0.5 text-[9.5px] text-ink-4">{compNote}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {asOfDate && (
                    <p className="mt-1.5 text-[9.5px] text-ink-4">as of {asOfDate}</p>
                  )}
                </div>
              )}

              {/* Professor ratings + instructor history (spec 013 §3c/§3d) —
                  NEAR-HORIZON ONLY (guardrail 3), rendered through the shared
                  ProfessorReview presenters so the verified/probable/snippet
                  guardrails live in one place. The "varies by instructor" badge
                  is the entry point that expands the term-by-term timeline
                  (Michael's amendment — the timeline is the powerful part);
                  when ratings don't diverge, the timeline shows quietly inline.
                  Nothing renders under the NullAdapter (courseReview null). */}
              {showReviews && courseReview && (
                <div>
                  <p className={cn("mb-2", SECTION_LABEL)}>Professor</p>
                  <div className="flex flex-col gap-2.5">
                    {courseReview.perProfessor.map((p) => (
                      <ProfessorRatingLine key={p.netid || p.instructor} entry={p} />
                    ))}
                  </div>
                  {reviewsVary ? (
                    <div className="mt-2.5">
                      <VariesByInstructorBadge
                        onToggle={() => setHistoryOpen((o) => !o)}
                        expanded={historyOpen}
                      />
                      {historyOpen && (
                        <InstructorTimeline history={courseReview.history} className="mt-2" />
                      )}
                    </div>
                  ) : (
                    courseReview.history.length > 1 && (
                      <InstructorTimeline history={courseReview.history} className="mt-2.5" />
                    )
                  )}
                </div>
              )}

              {/* Notes (spec 007 §1b/§3/§4, Unit 7C2) — docNotes (unparseable
                  prose: grade minimums, permission-of-instructor asides) +
                  unsatisfied advisory notes, deduped. Never a hard block —
                  informational prose between Description and Prerequisites. */}
              {noteLines.length > 0 && (
                <div>
                  <p className={cn("mb-1.5", SECTION_LABEL)}>Notes</p>
                  <div className="flex flex-col gap-1">
                    {noteLines.map((line, i) => (
                      <p key={i} className="t-body text-ink-2">
                        {line}
                      </p>
                    ))}
                  </div>
                  {noteMentionsCredit && (
                    <button
                      onClick={() => setCreditsOpen(true)}
                      className="mt-1.5 t-label text-drop-text opacity-80 transition-opacity hover:opacity-100"
                    >
                      Add AP credit
                    </button>
                  )}
                </div>
              )}

              {/* Prereq chip tree (spec 006 §D4 / #5 tree half). A vacuous expr
                  (empty and/or group) demands nothing — same as no expr. */}
              <div>
                <p className={cn("mb-2", SECTION_LABEL)}>Prerequisites</p>
                {hasPrereq ? (
                  <>
                    {/* "this course" anchor chip + connector into the tree. */}
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1">
                      <span className="font-mono text-[10.5px] font-medium text-ink">
                        {course.subject} {course.number}
                      </span>
                      <span className="text-[9.5px] text-ink-4">this course</span>
                    </div>
                    <div className="ml-3 h-3 w-0.5 bg-line-strong" aria-hidden="true" />
                    <PrereqTree
                      expr={full.prereq_expr!}
                      pools={pools.prereq}
                      noteOf={placementNoteOf}
                    />
                    <div className="mt-2.5 flex items-center gap-3 text-[9.5px] text-ink-4">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-[7px] w-[7px] rounded-full bg-complete" aria-hidden="true" />
                        met
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-[7px] w-[7px] rounded-full bg-destructive" aria-hidden="true" />
                        not met
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="t-body text-ink-3">No prerequisites — take it any semester.</p>
                )}
              </div>

              {hasCoreq && (
                <div>
                  <p className={cn("mb-2", SECTION_LABEL)}>Corequisites</p>
                  <PrereqTree
                    expr={full.coreq_expr!}
                    pools={pools.coreq}
                    noteOf={placementNoteOf}
                  />
                </div>
              )}
            </div>

            {/* Actions (spec 006 §D4). Complete/Waive act on the matching plan
                slot; when the course isn't placed yet, offer to place it. */}
            <div className="border-t border-line px-[22px] py-3.5">
              <div className="flex gap-2">
                {matchingSlot ? (
                  <>
                    <button
                      onClick={() => toggleCompleted(matchingSlot.id)}
                      className={cn(
                        ACTION_BTN,
                        "flex-1 border",
                        isCompleted
                          ? "border-[var(--complete-bd)] bg-complete-tint text-complete-text"
                          : "border-line-strong bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isCompleted ? "Completed" : "Mark complete"}
                    </button>
                    <button
                      onClick={() => toggleWaived(matchingSlot.id)}
                      className={cn(
                        ACTION_BTN,
                        "flex-none border",
                        isWaived
                          ? "border-[var(--waived-bd)] bg-waived-tint text-waived-text"
                          : "border-line-strong bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
                      )}
                    >
                      {isWaived ? <Undo2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      {isWaived ? "Remove waiver" : "Waive"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handlePlace}
                    className={cn(ACTION_BTN, "flex-1 bg-ink text-canvas hover:opacity-90")}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Place on roadmap
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
