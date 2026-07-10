import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, ArrowLeft, Check, Minus, Undo2, MapPin } from "lucide-react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { CATEGORY_META, subjectCategory } from "@/lib/planner/slotCategory";
import { formatCredits } from "@/lib/planner/semesters";
import { semesterPrereqPools } from "@/lib/planner/computeSlotStatusMap";
import { isVacuousPrereq } from "@/lib/planner/prereqTree";
import { PrereqTree } from "@/components/course/PrereqTree";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import type { PrereqPools } from "@/lib/planner/prereqTree";
import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";

/**
 * CourseDetailPanel (spec 006 §D4) — a right side-peek reusing RightSidebar's
 * slide-in idiom (480px, anime.js translate, visual-only backdrop). Opened from
 * a canvas card it slides over the canvas; from a catalog chip it layers over the
 * drawer (higher z) with a back affordance. Content: code · title · credits ·
 * category · offered terms · description · the recursive PrereqTree (and coreq) ·
 * "counts toward" the matching plan slot · a major-relevance line · actions
 * (place/arm, complete, waive — #9b's directory-context home). The favorite ★
 * lands with package E (favorites).
 *
 * Self-contained: it reads the plan + program slots from props/context so the
 * same component serves the planner and the /classes directory.
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

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
    toggleCompleted,
    toggleWaived,
  } = usePlan();

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

  // Slide-in / slide-out, mirroring RightSidebar's anime.js pattern.
  useEffect(() => {
    if (!panelRef.current || !backdropRef.current) return;
    const isFirst = !hasInitRef.current;
    hasInitRef.current = true;
    if (open) {
      backdropRef.current.style.display = "block";
      animate(backdropRef.current, { opacity: [0, 1], duration: 200, ease: "out(2)" });
      animate(panelRef.current, { x: 0, duration: isFirst ? 0 : 340, ease: "out(3)" });
    } else {
      animate(backdropRef.current, {
        opacity: [1, 0],
        duration: 180,
        ease: "in(2)",
        onComplete() {
          if (backdropRef.current) backdropRef.current.style.display = "none";
        },
      });
      animate(panelRef.current, { x: 520, duration: isFirst ? 0 : 300, ease: "in(2)" });
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

  const credits = full ? formatCredits({ min: full.credits_min, max: full.credits_max }) : null;
  const offered = full?.offered ?? [];
  const catMeta = category ? CATEGORY_META[category] : null;

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
          its fade stays in sync with the slide. */}
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="pointer-events-none fixed inset-0 z-[var(--z-detail-backdrop)]"
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
        style={{ transform: "translateX(520px)" }}
        className="fixed inset-y-0 right-0 z-[var(--z-detail-panel)] flex w-[480px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-xl"
      >
        {course && full && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <button
                onClick={close}
                className="inline-flex items-center gap-1 rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label={detailOverDrawer ? "Back to catalog" : "Close course details"}
              >
                {detailOverDrawer ? <ArrowLeft className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="t-label normal-case tracking-normal text-ink-2">
                  {course.subject} {course.number}
                </p>
                <p className="truncate t-headline">{full.title}</p>
              </div>
              <FavoriteStar courseId={course.id} size="md" className="shrink-0" />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {/* Meta row: credits · category · offered */}
              <div className="flex flex-wrap items-center gap-2">
                {credits && (
                  <span className="t-body text-ink-2">
                    <span className="num">{credits}</span> credits
                  </span>
                )}
                {catMeta && (
                  <span className={cn("inline-flex items-center rounded px-1.5 py-px t-meta font-medium", catMeta.text, catMeta.tint)}>
                    {catMeta.label}
                  </span>
                )}
                {offered.length > 0 && (
                  <span className="inline-flex items-center gap-1 t-meta text-ink-3">
                    Offered
                    {offered.map((t) => (
                      <span key={t} className="rounded border border-line px-1" title={TERM_NAMES[t] ?? t}>
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </div>

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
                  <p className="mb-1 t-label">About</p>
                  <p className="t-body text-ink-2">{full.description}</p>
                </div>
              )}

              {/* Prereq tree (spec 006 §D4 / #5 tree half). A vacuous expr
                  (empty and/or group) demands nothing — same as no expr. */}
              <div>
                <p className="mb-1.5 t-label">Prerequisites</p>
                {full.prereq_expr && !isVacuousPrereq(full.prereq_expr) ? (
                  <PrereqTree expr={full.prereq_expr} pools={pools.prereq} />
                ) : (
                  <p className="t-body text-ink-3">No prerequisites listed.</p>
                )}
              </div>

              {full.coreq_expr && !isVacuousPrereq(full.coreq_expr) && (
                <div>
                  <p className="mb-1.5 t-label">Corequisites</p>
                  <PrereqTree expr={full.coreq_expr} pools={pools.coreq} />
                </div>
              )}
            </div>

            {/* Actions (spec 006 §D4). Complete/Waive act on the matching plan
                slot; when the course isn't placed yet, offer to place it. */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
              {matchingSlot ? (
                <>
                  <button
                    onClick={() => toggleCompleted(matchingSlot.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 t-label transition-colors",
                      isCompleted
                        ? "border-complete/50 bg-complete-tint text-complete-text"
                        : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {isCompleted ? "Completed" : "Mark complete"}
                  </button>
                  <button
                    onClick={() => toggleWaived(matchingSlot.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 t-label transition-colors",
                      isWaived
                        ? "border-waived/50 bg-waived-tint text-waived-text"
                        : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    {isWaived ? <Undo2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    {isWaived ? "Remove waiver" : "Waive"}
                  </button>
                </>
              ) : (
                <button
                  onClick={handlePlace}
                  className="inline-flex items-center gap-1.5 rounded-md border border-drop/50 bg-drop-tint px-2.5 py-1.5 t-label text-drop-text transition-colors hover:bg-drop-tint/70"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Place on roadmap
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
