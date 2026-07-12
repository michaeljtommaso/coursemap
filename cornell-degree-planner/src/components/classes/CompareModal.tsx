import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Columns } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext, recordToCourse } from "@/contexts/CatalogProvider";
import { useReviews } from "@/contexts/ReviewsProvider";
import { usePlan } from "@/hooks/usePlan";
import { useEnrichedPlan } from "@/hooks/useEnrichedPlan";
import { buildCompletedSets } from "@/lib/planner/evaluatePrereq";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import { evaluate } from "@/lib/planner/satisfies";
import { buildUnlocksMap } from "@/lib/planner/unlocks";
import { horizonForSemester, rosterOfferGate, type Horizon } from "@/lib/planner/horizon";
import { componentNote, gradingBasisAllowsSU } from "@/lib/planner/sections";
import { formatCredits } from "@/lib/planner/semesters";
import type { ConflictPlacement } from "@/lib/planner/conflicts";
import {
  forbiddenOverlapCodes,
  topUnlocks,
  distributionTags,
  scheduleFit,
  professorEmptyState,
  EM_DASH,
  type ScheduleFit,
} from "@/lib/planner/compare";
import type { CourseReviewView } from "@/services/reviews";
import { ProfessorRatingLine } from "@/components/reviews/ProfessorReview";
import type { Course, ProgramSlotWithData } from "@/types/db";

/**
 * CompareModal (spec 013 §2) — the decision hub's side-by-side comparison. A
 * blocking modal in the app's existing dialog idiom (SignInDialog: portal +
 * real scrim + Esc), chosen over an inline expansion because the comparison is
 * WIDE (courses as columns) and shouldn't reflow the directory list underneath.
 * Every column is built from data already in hand (catalog + plan + the shared
 * engines) — no new fetching beyond ensuring the pinned courses' full docs. The
 * professor column reads the ReviewsProvider seam; under the NullAdapter it
 * resolves to null everywhere and renders honest empty states (spec §3a/§4).
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

type PrereqLabel = { text: string; tone: "met" | "advisory" | "blocked" | "none" };

type Column = {
  id: string;
  code: string;
  title: string;
  credits: string | null;
  terms: string;
  prereq: PrereqLabel;
  unlocks: { count: number; top: string[] };
  tags: string[];
  schedule: ScheduleFit;
  overlaps: string[];
  workload: string | null;
  horizon: Horizon;
};

function prereqLabelFor(course: Course, ctx: {
  completedIds: Set<string>;
  completedCodes: Set<string>;
  creditIds: Set<string>;
  creditCodes: Set<string>;
}): PrereqLabel {
  if (!course.prereq_expr) return { text: "None", tone: "none" };
  const r = evaluate(course.prereq_expr, {
    completedIds: ctx.completedIds,
    completedCodes: ctx.completedCodes,
    creditIds: ctx.creditIds,
    creditCodes: ctx.creditCodes,
  });
  if (r.state === "met") return { text: "Ready for you", tone: "met" };
  if (r.state === "advisory") return { text: "Usually needs earlier work", tone: "advisory" };
  // Missing course leaves arrive as raw dash ids ("CS-2110") — render display
  // form ("CS 2110"). Course ids are strictly SUBJ-NNNN so the global replace is
  // safe; pattern leaves already arrive in code form and pass through unchanged.
  const leaves = r.missing.slice(0, 2).map((m) => m.replace(/-/g, " ")).join(" or ");
  return { text: leaves ? `Needs ${leaves}` : "Prerequisites not met", tone: "blocked" };
}

export function CompareModal({
  slots,
  onClose,
}: {
  slots: ProgramSlotWithData[];
  onClose: () => void;
}) {
  const { pinnedCourseIds, togglePin, creditProfile, enteringYear } = useAuth();
  const { index, aliases, courseDetails, ensureCourseDetails, enrollmentTarget } = useCatalogContext();
  const reviews = useReviews();
  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();
  const { enrichedSlots, enrichedSelected } = useEnrichedPlan(slots);
  const panelRef = useRef<HTMLDivElement>(null);

  // Ensure the pinned courses' full docs (real prereq/attrs/sections/overlaps).
  useEffect(() => {
    if (pinnedCourseIds.length > 0) ensureCourseDetails(pinnedCourseIds);
  }, [pinnedCourseIds, ensureCourseDetails]);

  // Esc closes (app modal idiom).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const recordById = useMemo(
    () => new Map(index.map((r) => [r.id, r])),
    [index]
  );
  const unlocksMap = useMemo(() => buildUnlocksMap(index, aliases), [index, aliases]);
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);
  const completed = useMemo(
    () => buildCompletedSets(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
  );

  // The full course for each pinned id: prefer the fetched full doc, else the
  // lean index record projected to a Course (upgrades on the next render).
  const pinnedCourses = useMemo<Course[]>(() => {
    return pinnedCourseIds
      .map((id) => courseDetails[id] ?? (recordById.get(id) ? recordToCourse(recordById.get(id)!) : null))
      .filter((c): c is Course => c != null);
  }, [pinnedCourseIds, courseDetails, recordById]);

  // Near-horizon placements from the plan (the courses in your enrollment-term
  // column that carry this roster's sections) — the schedule-fit comparison set.
  // Mirrors useHorizonMap's near-placement build; consumes horizonForSemester.
  const nearPlacements = useMemo<ConflictPlacement[]>(() => {
    if (!enrollmentTarget) return [];
    const out: ConflictPlacement[] = [];
    for (const slot of enrichedSlots) {
      const h = horizonForSemester(slot.suggested_semester, enteringYear, enrollmentTarget);
      if (h !== "near") continue;
      const sel = slotSelections[slot.id];
      const course = sel ? enrichedSelected[sel] ?? null : slot.kind === "course" ? slot.courses : null;
      // ⚠️ gate on course.roster (the sync's SLUG), never roster_id (numeric
      // crseId — the 2026-07-11 naming-trap root cause).
      if (course && rosterOfferGate(course.roster, enrollmentTarget) === "offered") {
        out.push({
          slotId: slot.id,
          courseId: course.id,
          courseCode: `${course.subject} ${course.number}`,
          sections: course.sections,
        });
      }
    }
    return out;
  }, [enrichedSlots, enrichedSelected, slotSelections, enteringYear, enrollmentTarget]);

  const overlapMap = useMemo(
    () => forbiddenOverlapCodes(pinnedCourses.map((c) => ({ id: c.id, forbiddenOverlaps: c.forbidden_overlaps }))),
    [pinnedCourses]
  );

  const columns = useMemo<Column[]>(() => {
    return pinnedCourses.map((c) => {
      // Same roster-slug gate (never roster_id): "unknown" (null roster / no
      // target) reads as no target offer — the far column, no false claims.
      const hasTargetOffer = rosterOfferGate(c.roster, enrollmentTarget) === "offered";
      const horizon: Horizon = hasTargetOffer ? "near" : "far";
      // Schedule fit: build this course as the target placement, compare against
      // the near placements EXCLUDING any placement of the same course.
      const target: ConflictPlacement = {
        slotId: `pin:${c.id}`,
        courseId: c.id,
        courseCode: `${c.subject} ${c.number}`,
        sections: c.sections,
      };
      const schedule: ScheduleFit = hasTargetOffer
        ? scheduleFit(target, nearPlacements.filter((p) => p.courseId !== c.id))
        : { kind: "none" };
      const su = c.sections.some((s) => gradingBasisAllowsSU(s.gradingBasis));
      const compNote = componentNote(c.components);
      const workload = compNote || su ? [compNote, su ? "S/U option" : null].filter(Boolean).join(" · ") : null;
      return {
        id: c.id,
        code: `${c.subject} ${c.number}`,
        title: c.title,
        credits: formatCredits({ min: c.credits_min, max: c.credits_max }),
        terms: c.offered.map((t) => TERM_NAMES[t] ?? t).join(" · "),
        prereq: prereqLabelFor(c, {
          completedIds: completed.completedIds,
          completedCodes: completed.completedCodes,
          creditIds: creditCourses.ids,
          creditCodes: creditCourses.codes,
        }),
        unlocks: topUnlocks(unlocksMap.get(c.id) ?? []),
        tags: distributionTags(c.attrs),
        schedule,
        overlaps: overlapMap.get(c.id) ?? [],
        workload,
        horizon,
      };
    });
  }, [pinnedCourses, enrollmentTarget, nearPlacements, completed, creditCourses, unlocksMap, overlapMap]);

  // Professor column via the ReviewsProvider seam. Under the NullAdapter every
  // getCourseView resolves to null → every cell renders its honest empty state
  // and zero professor UI appears (spec §3a/§4 kill switch).
  const [reviewViews, setReviewViews] = useState<Record<string, CourseReviewView | null>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        pinnedCourseIds.map(async (id) => [id, await reviews.getCourseView(id)] as const)
      );
      if (!cancelled) setReviewViews(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [pinnedCourseIds, reviews]);

  const scheduleText = (s: ScheduleFit): string =>
    s.kind === "fits" ? "Fits your term" : s.kind === "collides" ? `Collides with ${s.withCode}` : EM_DASH;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compare courses"
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="relative flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
          <Columns className="h-4 w-4 text-ink-3" />
          <h2 className="t-headline">Compare</h2>
          <span className="t-meta text-ink-4">
            <span className="num">{columns.length}</span> courses
          </span>
          <button
            onClick={onClose}
            aria-label="Close compare"
            className="ml-auto rounded-md p-1 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 w-32 bg-surface px-4 py-3 align-bottom" />
                {columns.map((col) => (
                  <th key={col.id} className="min-w-[170px] px-3 py-3 align-bottom">
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-semibold text-ink">{col.code}</p>
                        <p className="mt-0.5 truncate t-meta text-ink-2" title={col.title}>{col.title}</p>
                      </div>
                      <button
                        onClick={() => togglePin(col.id)}
                        aria-label={`Remove ${col.code} from compare`}
                        title="Unpin"
                        className="shrink-0 rounded p-0.5 text-ink-4 transition-colors hover:text-ink"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              <Row label="Credits">
                {columns.map((c) => <Cell key={c.id}><span className="num">{c.credits ?? EM_DASH}</span></Cell>)}
              </Row>
              <Row label="Terms offered">
                {columns.map((c) => <Cell key={c.id}>{c.terms || EM_DASH}</Cell>)}
              </Row>
              <Row label="Prereqs for you">
                {columns.map((c) => (
                  <Cell key={c.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          c.prereq.tone === "met" && "bg-complete",
                          c.prereq.tone === "blocked" && "bg-destructive",
                          c.prereq.tone === "advisory" && "bg-ink-3",
                          c.prereq.tone === "none" && "bg-line-strong"
                        )}
                      />
                      <span className={cn(c.prereq.tone === "blocked" && "text-destructive-text")}>
                        {c.prereq.text}
                      </span>
                    </span>
                  </Cell>
                ))}
              </Row>
              <Row label="Unlocks">
                {columns.map((c) => (
                  <Cell key={c.id}>
                    {c.unlocks.count > 0 ? (
                      <span>
                        <span className="num font-semibold text-ink">{c.unlocks.count}</span>
                        {c.unlocks.top.length > 0 && (
                          <span className="ml-1 t-meta text-ink-4">{c.unlocks.top.join(", ")}{c.unlocks.count > c.unlocks.top.length ? "…" : ""}</span>
                        )}
                      </span>
                    ) : EM_DASH}
                  </Cell>
                ))}
              </Row>
              <Row label="Distribution">
                {columns.map((c) => (
                  <Cell key={c.id}>
                    {c.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className="rounded border border-line px-1 font-mono text-[9.5px] text-ink-3">{t}</span>
                        ))}
                      </span>
                    ) : EM_DASH}
                  </Cell>
                ))}
              </Row>
              <Row label="Schedule fit">
                {columns.map((c) => (
                  <Cell key={c.id}>
                    <span className={cn(c.schedule.kind === "collides" && "text-available-text")}>
                      {scheduleText(c.schedule)}
                    </span>
                  </Cell>
                ))}
              </Row>
              <Row label="Overlap warning">
                {columns.map((c) => (
                  <Cell key={c.id}>
                    {c.overlaps.length > 0 ? (
                      <span className="text-available-text">Credit for only one of this and {c.overlaps.join(", ")}</span>
                    ) : EM_DASH}
                  </Cell>
                ))}
              </Row>
              <Row label="Workload">
                {columns.map((c) => <Cell key={c.id}>{c.workload || EM_DASH}</Cell>)}
              </Row>
              <Row label="Professor">
                {columns.map((c) => {
                  const view = reviewViews[c.id];
                  // Ratings are NEAR-HORIZON ONLY (spec §3e guardrail 3): a far
                  // column shows the honest empty state, never a rating for an
                  // instructor who isn't announced yet. NullAdapter → view null →
                  // empty state everywhere (the shipped default).
                  const showRatings = c.horizon === "near" && view && view.perProfessor.length > 0;
                  if (showRatings) {
                    return (
                      <Cell key={c.id}>
                        <div className="flex flex-col gap-2">
                          {view!.perProfessor.map((p) => (
                            <ProfessorRatingLine key={p.netid || p.instructor} entry={p} />
                          ))}
                        </div>
                      </Cell>
                    );
                  }
                  return (
                    <Cell key={c.id}>
                      <span className="text-ink-4">{professorEmptyState(c.horizon, !!enrollmentTarget)}</span>
                    </Cell>
                  );
                })}
              </Row>
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 w-32 bg-surface px-4 py-2.5 align-top font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-4"
      >
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 align-top t-body text-ink-2">{children}</td>;
}
