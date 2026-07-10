import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { Search, RotateCw, Info } from "lucide-react";
import { animate, stagger } from "animejs";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useCourseFilters, type CourseFilters } from "@/hooks/useCourseFilters";
import { dragState } from "@/lib/drag/dragState";
import { usePlan } from "@/hooks/usePlan";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { evaluatePrereq, buildCompletedSets } from "@/lib/planner/evaluatePrereq";
import { formatCredits } from "@/lib/planner/semesters";
import { CatalogChipSkeleton } from "@/components/ui/skeleton";
import { CatalogFilterChips } from "@/components/catalog/CatalogFilterChips";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import { useAuth } from "@/contexts/AuthProvider";
import { cn } from "@/lib/utils";
import type { Course, ProgramSlotWithData } from "@/types/db";

function CourseChip({
  course,
  prereqsMet,
}: {
  course: Course;
  prereqsMet: boolean | null; // true = met, false = not met, null = no prereqs
}) {
  const ref = useRef<HTMLDivElement>(null);

  const isDraggingThis = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.courseId === course.id
  );

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const onEnter = () => {
      if (!dragState.get())
        animate(el, { y: -2, scale: 1.02, duration: 120, ease: "out(2)" });
    };
    const onLeave = () =>
      animate(el, { y: 0, scale: 1, duration: 150, ease: "out(2)" });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const armCourse = usePlannerStore((s) => s.armCourse);
  const disarm = usePlannerStore((s) => s.disarm);
  const openCourseDetail = usePlannerStore((s) => s.openCourseDetail);
  const { favoriteCourseIds } = useAuth();
  const isFav = favoriteCourseIds.includes(course.id);
  const isArmed = armedCourse?.id === course.id;

  // 6px movement threshold before a drag starts (spec 004 §4): a plain click
  // (or tap) ARMS the course for click-to-place instead — which also restores
  // touch scrolling in this list (no preventDefault on pointerdown).
  const dragCandidate = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    dragCandidate.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const start = dragCandidate.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      dragCandidate.current = null;
      disarm();
      const r = ref.current?.getBoundingClientRect();
      dragState.start({
        courseId: course.id,
        course,
        sourceSlotId: null,
        startX: e.clientX,
        startY: e.clientY,
        originRect: r
          ? { left: r.left, top: r.top, width: r.width, height: r.height }
          : null,
        sourceEl: ref.current ?? null,
      });
    }
  };
  const handleClick = () => {
    dragCandidate.current = null;
    if (isArmed) disarm();
    else armCourse(course, null);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const label = `${course.subject} ${course.number}`;
  const credits = formatCredits({ min: course.credits_min, max: course.credits_max });

  return (
    <div
      ref={ref}
      data-chip
      role="button"
      tabIndex={0}
      aria-label={`${label}, ${course.title}${prereqsMet === false ? ", prerequisites not yet covered" : ""}. ${isArmed ? "Armed — pick a slot on the roadmap, or press Escape." : "Press Enter to place it, or drag it to a slot."}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => (dragCandidate.current = null)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ touchAction: "pan-y" }}
      // Unified state vocabulary (spec 006 §B.1/§B.3, triage #10): red/
      // destructive tint = "you can't take this yet" (unmet prereqs, same
      // treatment as the canvas's blocked state), subtle green = met. A
      // catalog course has no semester so offeredOk/coreq-concurrent don't
      // apply here — this stays a prereq-only check against the current plan.
      title={prereqsMet === false ? "Prerequisites not yet met" : undefined}
      className={cn(
        "group relative cursor-grab rounded-md border px-2 py-1.5 select-none",
        "transition-colors active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
        prereqsMet === false
          ? "border-destructive/30 bg-destructive-tint/70 hover:border-destructive/50 hover:bg-destructive-tint"
          : "border-line bg-surface hover:border-complete hover:bg-complete-tint",
        isArmed && "border-[1.5px] border-drop bg-drop-tint opacity-100",
        isDraggingThis && "opacity-30"
      )}
    >
      {prereqsMet === true && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-complete"
          title="Prerequisites met"
        />
      )}
      {prereqsMet === false && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive"
          title="Prerequisites not met"
        />
      )}
      <span className="flex items-baseline justify-between gap-1.5 pr-2.5">
        <span
          className={cn(
            "t-label normal-case tracking-normal",
            prereqsMet === false ? "text-destructive-text" : "text-ink"
          )}
        >
          {label}
        </span>
        {credits && (
          <span className="shrink-0 t-meta text-ink-3">
            <span className="num">{credits}</span> cr
          </span>
        )}
      </span>
      <span className="mt-0.5 block truncate t-meta">{course.title}</span>

      {/* Action cluster (bottom-right): favorite ★ (spec 006 §E4) + info
          affordance (spec 006 §D4, opens the detail peek). Hover/focus-revealed;
          both stop propagation so they never arm/drag. */}
      <span className="absolute bottom-1 right-1.5 inline-flex items-center gap-0.5">
        <FavoriteStar
          courseId={course.id}
          className={cn(
            "!p-0 transition-opacity",
            isFav
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          )}
        />
        <button
          onClick={(e) => { e.stopPropagation(); openCourseDetail(course); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Details for ${label}`}
          title="Course details"
          className="inline-flex items-center rounded p-0.5 text-ink-4 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Info className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

export function CourseCatalog({ slots }: { slots: ProgramSlotWithData[] }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CourseFilters>({});
  const { courseDetails, ensureCourseDetails, index } = useCatalogContext();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { favoriteCourseIds } = useAuth();
  const favorites = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);

  // Shared filter model (spec 006 §E3) — same predicate the /classes page uses.
  const { predicate, hasOffered } = useCourseFilters(index, slots, { favorites });
  const { results, loading, error, refetch } = useCourseSearch(query, filters, predicate);

  // Consume a pending catalog seed (spec 006 §D3): an empty slot's "＋ Find a
  // class" opens the drawer pre-filtered to its rule. Apply once, then clear.
  const catalogSeed = usePlannerStore((s) => s.catalogSeed);
  const clearCatalogSeed = usePlannerStore((s) => s.clearCatalogSeed);
  useEffect(() => {
    if (catalogSeed != null) {
      setQuery(catalogSeed);
      clearCatalogSeed();
    }
  }, [catalogSeed, clearCatalogSeed]);

  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();

  const { completedIds, completedCodes } = useMemo(
    () => buildCompletedSets(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
  );

  // Search-index records carry no prereq_expr (only a hasPrereqs flag), so chips
  // can't evaluate from them. Fetch the full docs for the currently-rendered page
  // only (search caps at 40) — batched, deduped, and session-cached in
  // CatalogProvider so each course is read at most once ever, never a scan. A
  // chip shows neutral until its doc arrives, then red/green on the next render.
  useEffect(() => {
    if (results.length > 0) ensureCourseDetails(results.map((r) => r.id));
  }, [results, ensureCourseDetails]);

  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current || results.length === 0) return;
    if (results.length === prevLengthRef.current) return;
    prevLengthRef.current = results.length;

    const chips = containerRef.current.querySelectorAll("[data-chip]");
    animate(chips, {
      opacity: [0, 1],
      y: [10, 0],
      delay: stagger(18, { ease: "out(2)" }),
      duration: 220,
      ease: "out(3)",
    });
  }, [results.length]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="mb-1 t-label">Course Catalog</p>
        <p className="mb-3 t-meta">
          Find a course, then drag it to a slot — or tap it, then tap where it goes.
        </p>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CS 1110, Calculus…"
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-6 pr-2 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink"
          />
        </div>

        <div className="mt-2">
          <CatalogFilterChips
            filters={filters}
            onChange={setFilters}
            hasProgram={!!selectedProgramId}
            hasOffered={hasOffered}
            showFavorites
          />
        </div>
      </div>

      {/* Error honesty — a dead catalog is distinct from "no results" (spec §5.2) */}
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

      {loading && !error && <CatalogChipSkeleton rows={6} />}

      {!loading && !error && results.length === 0 && query && (
        <p className="t-meta">
          Nothing matches &ldquo;{query}&rdquo; — try a course code like CS 2110,
          or a topic like &ldquo;algorithms&rdquo;.
        </p>
      )}

      {!loading && !error && results.length === 0 && !query && (
        <p className="t-meta">
          Try a course code like CS 2110, or a topic like &ldquo;thermodynamics&rdquo;.
        </p>
      )}

      <div ref={containerRef} className="flex flex-col gap-1.5 overflow-y-auto">
        {!loading &&
          !error &&
          results.map((course) => {
            // Real prereq_expr lives on the full doc (courseDetails), not the
            // search-index record. null until the doc is cached → neutral chip.
            const expr = courseDetails[course.id]?.prereq_expr ?? null;
            const met = expr
              ? evaluatePrereq(expr, completedIds, completedCodes)
              : null;
            return <CourseChip key={course.id} course={course} prereqsMet={met} />;
          })}
      </div>
    </div>
  );
}
