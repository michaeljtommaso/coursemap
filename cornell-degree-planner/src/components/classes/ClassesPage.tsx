import { useCallback, useEffect, useMemo, useState } from "react";
import { TourLink } from "@/components/tour/TourLink";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { Link } from "react-router-dom";
import { Search, RotateCw, ArrowLeft } from "lucide-react";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { recordToCourse } from "@/lib/catalog/recordToCourse";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useBoard } from "@/hooks/useBoard";
import {
  useCourseFilters,
  buildPlanPools,
  type CourseFilters,
} from "@/hooks/useCourseFilters";
import { usePlan } from "@/hooks/usePlan";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import { useAuth } from "@/contexts/AuthProvider";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { CourseDetailPanel } from "@/components/course/CourseDetailPanel";
import { DirectoryRow } from "@/components/classes/DirectoryRow";
import { CourseFilterBar } from "@/components/classes/CourseFilterBar";
import { CompareTray } from "@/components/classes/CompareTray";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import { PinButton } from "@/components/course/PinButton";
import { CatalogChipSkeleton } from "@/components/ui/skeleton";
import { Toast } from "@/components/ui/Toast";
import { rankSearch } from "@/lib/catalog/rankSearch";
import { FEATURES } from "@/config/features";
import { useProfessorRatings } from "@/hooks/useProfessorRatings";
import { TargetTermSwitch } from "@/components/classes/TargetTermSwitch";
import {
  browserStorage,
  formatRosterTerm,
  initialTargetFilterOn,
  saveTargetFilterChoice,
  selectDirectoryResults,
  directoryReady,
  shouldResetDirectoryWindow,
} from "@/lib/classes/targetFilter";
import { wellRatedChipVisible } from "@/lib/classes/professorRatings";
import type { ScheduleQuery } from "@/lib/classes/schedule";
import { requirementOptions } from "@/lib/classes/requirementFilter";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { useCountsTowardParam } from "@/hooks/useCountsTowardParam";

/**
 * ClassesPage (spec 006 §E2) — the full course directory over the in-memory
 * catalogIndex (4,472 records). Incremental rendering ("Load more" in ~100-row
 * batches, no virtualization dependency), sorted subject + number (the index is
 * pre-sorted). Search + the shared filter model (§E3) narrow the list; a row
 * click opens the CourseDetailPanel (§D4), reused verbatim from the planner.
 *
 * Spec 017: the page opens filtered to the enrollment-term roster (D1) behind a
 * labeled switch above the list, remembered per browser for the current target
 * only (D3); a search with no enrollment-term match falls back to courses
 * known to be on another term's roster, labeled "Not offered <term>" (a course
 * with no roster on record is never labeled). When even that is empty, the
 * empty state says the switch is on and offers "Show all" — a signal, never a
 * block. Rows carry the lead lecturer and,
 * when ratings are on, their rating (D4); the well-rated chip is opt-in (D7).
 */

const BATCH = 100;

/** How long the list waits for catalog/meta once the index is in, before
 *  showing the full catalog anyway (a slow meta read never blocks the page). */
const META_WAIT_MS = 2500;

export function ClassesPage() {
  const {
    index,
    loading,
    error,
    refetch,
    aliases,
    ensureCourseDetails,
    enrollmentTarget,
    metaSettled,
  } = useCatalogContext();
  const openCourseDetail = usePlannerStore((s) => s.openCourseDetail);
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { cards, templateSlots } = useBoard();
  const { favoriteCourseIds, enteringYear } = useAuth();
  const { resolved: creditProfile } = useCreditProfile();
  const { completedIds, inProgressIds } = usePlan();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CourseFilters>({});
  const [visible, setVisible] = useState(BATCH);

  // First paint waits for catalog/meta: deciding the term switch before the
  // enrollment term is known would paint the whole catalog, then snap to the
  // term's courses. Bounded by META_WAIT_MS after the index arrives.
  const [metaWaitedOut, setMetaWaitedOut] = useState(false);
  useEffect(() => {
    if (loading || metaSettled) return;
    const t = setTimeout(() => setMetaWaitedOut(true), META_WAIT_MS);
    return () => clearTimeout(t);
  }, [loading, metaSettled]);
  const listReady = directoryReady({ indexLoading: loading, metaSettled, metaWaitedOut });
  const favorites = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  // Shared filter/search predicate over index records (spec 006 §E3).
  // The plan's courses by status, for the "Prereqs met by" filter.
  const planPools = useMemo(
    () =>
      buildPlanPools(
        cards.map((c) => ({ placementId: c.placement.id, course: c.course })),
        completedIds,
        inProgressIds,
        buildCreditCourses(creditProfile)
      ),
    [cards, completedIds, inProgressIds, creditProfile]
  );
  // Spec 022 — "Counts toward" lists the plan's open requirements, the same
  // groups the board's Still-needed panel shows.
  const progress = useRequirementProgress();
  const requirementGroups = useMemo(() => requirementOptions(progress.groups), [progress.groups]);
  useCountsTowardParam(setFilters, requirementGroups); // spec 028: Requirements page "Find a class"
  const { ratings, ready: ratingsReady } = useProfessorRatings();
  const {
    predicate,
    subjects,
    hasOffered,
    hasRoster,
    hasMeetings,
    prereqCandidatesFor,
    tagCounts,
  } = useCourseFilters(
    index,
    templateSlots,
    { favorites, planPools, ratings, cards, enteringYear }
  );

  // Enrollment-term switch (spec 017 D1/D3). Shown only with a target AND an
  // index that actually carries rosters; the student's explicit choice for this
  // target wins over the stored one, which wins over the default (on).
  const showTargetSwitch = !!enrollmentTarget && hasRoster;
  const targetLabel = formatRosterTerm(enrollmentTarget) ?? enrollmentTarget ?? "";
  const storedTargetOn = useMemo(
    () => initialTargetFilterOn(browserStorage(), enrollmentTarget),
    [enrollmentTarget]
  );
  const [targetChoice, setTargetChoice] = useState<{ target: string; on: boolean } | null>(null);
  const targetOn =
    showTargetSwitch &&
    (targetChoice && targetChoice.target === enrollmentTarget ? targetChoice.on : storedTargetOn);
  const setTargetOn = useCallback(
    (on: boolean) => {
      if (!enrollmentTarget) return;
      setTargetChoice({ target: enrollmentTarget, on });
      saveTargetFilterChoice(browserStorage(), enrollmentTarget, on);
    },
    [enrollmentTarget]
  );

  // Well-rated chip (spec 017 D7): only with ratings on and loaded.
  const showWellRated = wellRatedChipVisible(FEATURES.rateMyProfessor, ratingsReady, ratings.size);

  // What the predicate actually applies: the sidebar's filters plus the term
  // switch (kept outside the sidebar so its Clear never flips it). A well-rated
  // selection with no ratings to judge by narrows nothing rather than everything.
  const effectiveFilters = useMemo<CourseFilters>(
    () => ({
      ...filters,
      onTargetRoster: targetOn ? true : undefined,
      wellRated: showWellRated ? filters.wellRated : undefined,
    }),
    [filters, targetOn, showWellRated]
  );

  // "Prereqs met by" needs the prerequisite trees of exactly the courses the
  // chosen statuses unlock — fetched on demand, session-cached, never a scan.
  const metBy = filters.prereqsMetBy;
  useEffect(() => {
    if (metBy && metBy.length > 0) ensureCourseDetails([...prereqCandidatesFor(metBy)]);
  }, [metBy, prereqCandidatesFor, ensureCourseDetails]);

  // Ranked in-memory search (rankSearch), narrowed by the shared predicate.
  // With the term switch on, a query with no enrollment-term match falls back
  // to the same search without the term axis (spec 017 D1), flagged for a note.
  const { rows: results, notOnTarget } = useMemo(() => {
    const primary = rankSearch(index, query, {
      aliases,
      filter: (r) => predicate(r, effectiveFilters),
    });
    const withoutTerm = { ...effectiveFilters, onTargetRoster: undefined };
    return selectDirectoryResults(primary, {
      targetOn,
      query,
      target: enrollmentTarget,
      others: () => rankSearch(index, query, { aliases, filter: (r) => predicate(r, withoutTerm) }),
    });
  }, [index, query, effectiveFilters, predicate, aliases, targetOn, enrollmentTarget]);

  // Reset the window when the student changes the search, a filter or the
  // term switch (adjusted during render rather than in an effect, so there's
  // no extra pass at the old size). Keyed on their choices, not on
  // effectiveFilters: the ratings file arriving flips showWellRated, which must
  // not throw the list back to the top.
  const windowKey = { query, filters, targetOn };
  const [windowFor, setWindowFor] = useState(windowKey);
  if (shouldResetDirectoryWindow(windowFor, windowKey)) {
    setWindowFor(windowKey);
    setVisible(BATCH);
  }

  const shown = results.slice(0, visible);

  // Spec 021 — with a days/time filter on, each row's time chip leads with the
  // lecture option that fits it (the reason the course matched).
  const rowScheduleQuery = useMemo<ScheduleQuery | null>(
    () =>
      filters.days?.length || filters.timeFrom != null || filters.timeTo != null
        ? { days: filters.days, from: filters.timeFrom, to: filters.timeTo, parts: "lecture" }
        : null,
    [filters.days, filters.timeFrom, filters.timeTo]
  );

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/* Header + nav */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface/70 px-5 py-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to planner
        </Link>
        <h1 className="t-headline">Course directory</h1>
        <span className="t-meta text-ink-4">
          <span className="num">{index.length}</span> Cornell courses
        </span>
        <div className="ml-auto">
          <TourLink tour="classes" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Filter sidebar (spec 006 §E3) */}
        <CourseFilterBar
          filters={filters}
          onChange={setFilters}
          subjects={subjects}
          hasProgram={!!selectedProgramId}
          hasOffered={hasOffered}
          showFavorites
          showWellRated={showWellRated}
          hasMeetings={hasMeetings}
          semesterLabel={enrollmentTarget ? targetLabel : null}
          requirementGroups={requirementGroups}
          tagCounts={tagCounts}
        />

        <main className="flex min-h-0 flex-1 flex-col">
          {/* Search */}
          <div className="shrink-0 border-b border-line px-5 py-3">
            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or title — CS 2110, thermodynamics…"
                className="w-full rounded-md border border-line bg-surface py-2 pl-8 pr-3 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {error && (
              <div className="flex flex-col items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive-tint px-3 py-2.5">
                <p className="t-body font-semibold text-destructive-text">
                  Couldn&apos;t reach the course catalog
                </p>
                <button
                  onClick={refetch}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 t-label text-destructive-text transition-colors hover:bg-destructive/10"
                >
                  <RotateCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}

            {!listReady && !error && <CatalogChipSkeleton rows={10} />}

            {listReady && !error && (
              <>
                {showTargetSwitch && (
                  <TargetTermSwitch on={targetOn} termLabel={targetLabel} onChange={setTargetOn} />
                )}
                <p className="mb-2 t-meta text-ink-3">
                  <span className="num">{results.length}</span>{" "}
                  {results.length === 1 ? "course" : "courses"}
                  {query || Object.values(filters).some((v) => v !== undefined)
                    ? results.length === 1
                      ? " matches your filters"
                      : " match your filters"
                    : ""}
                </p>
                {notOnTarget && (
                  <p className="mb-2 t-body text-ink-2" role="status">
                    Nothing on the {targetLabel} roster matches.{" "}
                    <span className="font-semibold">Not offered {targetLabel}:</span>
                  </p>
                )}
                {results.length === 0 && targetOn ? (
                  <div className="flex flex-col items-start gap-1.5" data-testid="target-empty">
                    <p className="t-body text-ink-3">
                      Nothing on the {targetLabel} roster matches. You&apos;re seeing{" "}
                      {targetLabel} classes only.
                    </p>
                    <button
                      type="button"
                      onClick={() => setTargetOn(false)}
                      className="rounded-md border border-line bg-surface px-2 py-1 t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      Show all
                    </button>
                  </div>
                ) : results.length === 0 ? (
                  <p className="t-body text-ink-3">
                    Nothing matches — try a broader search or clear a filter.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {shown.map((r) => (
                      <DirectoryRow
                        key={r.id}
                        record={r}
                        enrollmentTarget={enrollmentTarget}
                        ratings={ratings}
                        scheduleQuery={rowScheduleQuery}
                        onOpen={() => openCourseDetail(recordToCourse(r), { overDrawer: false })}
                        leading={
                          <span className="inline-flex items-center gap-0.5">
                            <FavoriteStar courseId={r.id} />
                            <PinButton courseId={r.id} />
                          </span>
                        }
                      />
                    ))}
                  </ul>
                )}
                {visible < results.length && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={() => setVisible((v) => v + BATCH)}
                      className="rounded-md border border-line bg-surface px-4 py-2 t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      Load more ({results.length - visible} left)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Compare tray (spec 013 §2) — docked at the foot of the directory
              column; appears once ≥1 course is pinned. */}
          <CompareTray cards={cards} />
        </main>
      </div>

      <CourseDetailPanel cards={cards} templateSlots={templateSlots} />
      <TourOverlay tour="classes" />
      {/* The store-driven toast (pin/favorite save-failure notices) must render
          on THIS route too — AppShell's instance only covers the planner. Only
          one route is mounted at a time, so there's never a double toast. */}
      <Toast />
    </div>
  );
}
