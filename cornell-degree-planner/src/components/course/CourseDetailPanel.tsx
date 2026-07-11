import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, ArrowLeft, Check, Clock, Minus, Undo2, MapPin } from "lucide-react";
import { animate, spring } from "animejs";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useSlotStatus } from "@/hooks/useSlotStatus";
import { CATEGORY_META, subjectCategory } from "@/lib/planner/slotCategory";
import { formatCredits, semesterLabel } from "@/lib/planner/semesters";
import { semesterPrereqPools } from "@/lib/planner/computeSlotStatusMap";
import { isVacuousPrereq } from "@/lib/planner/prereqTree";
import { prefersReducedMotion } from "@/lib/motion";
import { PrereqTree } from "@/components/course/PrereqTree";
import { FavoriteStar } from "@/components/course/FavoriteStar";
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

  const { courseDetails, ensureCourseDetails } = useCatalogContext();
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
  const { statusMap } = useSlotStatus(slots);

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
        animate(panelRef.current, { x: 0, ease: spring({ bounce: 0.18, duration: 340 }) });
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
        matchingSlot.suggested_semester
      );
      return {
        prereq: { completedIds: p.completedIds, completedCodes: p.completedCodes, concurrentIds: p.concurrentIds },
        coreq: { completedIds: p.concurrentIds, completedCodes: p.concurrentCodes, concurrentIds: p.concurrentIds },
      };
    }
    const ids = new Set<string>();
    const codes = new Set<string>();
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
  }, [matchingSlot, slots, slotSelections, selectedCourses, completedSlotIds]);

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
      if (!info) return null;
      if (info.completed) return "completed";
      if (info.inProgress) return "in progress";
      const label = semesterLabel(info.sem, null);
      return `planned — ${label.primary} of year ${Math.ceil(info.sem / 2)}`;
    };
  }, [slots, slotSelections, selectedCourses, completedSlotIds, inProgressSlotIds]);

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
      {/* Visual-only backdrop (pointer-events-none) — the panel closes via ×,
          back, or Escape, so this never has to intercept a click; kept only so
          its fade stays in sync with the slide. Scrim color is the extract's
          rgb(15 23 42 / .35) — no scrim token exists yet. */}
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="pointer-events-none fixed inset-0 z-[var(--z-detail-backdrop)] bg-[rgb(15_23_42/0.35)]"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={course ? `${course.subject} ${course.number} details` : "Course details"}
        // stopPropagation so RightSidebar's outside-click listener doesn't close
        // the drawer underneath while the peek is interacted with.
        onPointerDown={(e) => e.stopPropagation()}
        style={{ transform: "translateX(510px)" }}
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

              {/* Chip row: credits (mono) · category tag · offered terms */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
                {credits && (
                  <span className="inline-flex items-center rounded-[5px] border border-line px-[7px] py-[2px] font-mono text-[10px] text-ink-2">
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
                <p className="pt-2 text-[10.5px] font-bold text-destructive-text">
                  {blockedLine(slotStatus.unmetPrereqLeaves)}
                </p>
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
