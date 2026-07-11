import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search, RotateCw, ArrowLeft } from "lucide-react";
import { useCatalogContext, recordToCourse } from "@/contexts/CatalogProvider";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useProgramData } from "@/hooks/useProgramData";
import { useEffectiveSlots } from "@/hooks/useEffectiveSlots";
import { useCourseFilters, type CourseFilters } from "@/hooks/useCourseFilters";
import { useAuth } from "@/contexts/AuthProvider";
import { CourseDetailPanel } from "@/components/course/CourseDetailPanel";
import { DirectoryRow } from "@/components/classes/DirectoryRow";
import { CourseFilterBar } from "@/components/classes/CourseFilterBar";
import { CompareTray } from "@/components/classes/CompareTray";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import { PinButton } from "@/components/course/PinButton";
import { CatalogChipSkeleton } from "@/components/ui/skeleton";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * ClassesPage (spec 006 §E2) — the full course directory over the in-memory
 * catalogIndex (4,472 records). Incremental rendering ("Load more" in ~100-row
 * batches, no virtualization dependency), sorted subject + number (the index is
 * pre-sorted). Search + the shared filter model (§E3) narrow the list; a row
 * click opens the CourseDetailPanel (§D4), reused verbatim from the planner.
 */

const BATCH = 100;

export function ClassesPage() {
  const { index, loading, error, refetch } = useCatalogContext();
  const openCourseDetail = usePlannerStore((s) => s.openCourseDetail);
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { slots } = useProgramData(selectedProgramId);
  const { effectiveSlots } = useEffectiveSlots(slots);
  const { favoriteCourseIds } = useAuth();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CourseFilters>({});
  const [visible, setVisible] = useState(BATCH);

  const favorites = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  // Shared filter/search predicate over index records (spec 006 §E3).
  const { predicate, subjects, hasOffered } = useCourseFilters(index, effectiveSlots, { favorites });

  const results = useMemo(() => {
    const q = query.trim();
    const idQ = q.toUpperCase().replace(/\s+/g, "-");
    const titleQ = q.toLowerCase();
    const matchesQuery = (r: CatalogIndexRecord) =>
      !q || r.id.toUpperCase().includes(idQ) || r.title.toLowerCase().includes(titleQ);
    // The index is already sorted subject+number by the build pipeline.
    return index.filter((r) => matchesQuery(r) && predicate(r, filters));
  }, [index, query, filters, predicate]);

  // Reset the window whenever the result set changes shape.
  useEffect(() => {
    setVisible(BATCH);
  }, [query, filters]);

  const shown = results.slice(0, visible);

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

            {loading && !error && <CatalogChipSkeleton rows={10} />}

            {!loading && !error && (
              <>
                <p className="mb-2 t-meta text-ink-3">
                  <span className="num">{results.length}</span>{" "}
                  {results.length === 1 ? "course" : "courses"}
                  {query || Object.values(filters).some((v) => v !== undefined)
                    ? " match your filters"
                    : ""}
                </p>
                {results.length === 0 ? (
                  <p className="t-body text-ink-3">
                    Nothing matches — try a broader search or clear a filter.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line/70">
                    {shown.map((r) => (
                      <DirectoryRow
                        key={r.id}
                        record={r}
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
          <CompareTray slots={effectiveSlots} />
        </main>
      </div>

      <CourseDetailPanel slots={effectiveSlots} />
    </div>
  );
}
