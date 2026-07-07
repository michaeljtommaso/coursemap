import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { Search, RotateCw } from "lucide-react";
import { animate, stagger } from "animejs";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { dragState } from "@/lib/drag/dragState";
import { usePlan } from "@/hooks/usePlan";
import { evaluatePrereq, buildCompletedSets } from "@/lib/planner/evaluatePrereq";
import { CatalogChipSkeleton } from "@/components/ui/skeleton";
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

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragState.start({
      courseId: course.id,
      course,
      sourceSlotId: null,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  const label = `${course.subject} ${course.number}`;

  return (
    <div
      ref={ref}
      data-chip
      onPointerDown={handlePointerDown}
      className={cn(
        "relative cursor-grab rounded-md border px-2 py-1.5 select-none",
        "transition-colors active:cursor-grabbing",
        prereqsMet === false
          ? "border-line bg-surface-2/60 opacity-60 hover:opacity-90"
          : "border-line bg-surface hover:border-available hover:bg-available-tint",
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
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink-4"
          title="Prerequisites not met"
        />
      )}
      <span className="t-label normal-case tracking-normal text-ink">{label}</span>
      <span className="mt-0.5 block truncate t-meta">{course.title}</span>
    </div>
  );
}

export function CourseCatalog({ slots }: { slots: ProgramSlotWithData[] }) {
  const [query, setQuery] = useState("");
  const { results, loading, error, refetch } = useCourseSearch(query);

  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();

  const { completedIds, completedCodes } = useMemo(
    () => buildCompletedSets(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
  );

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
        <p className="mb-3 t-meta">Search and drag courses to elective slots</p>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CS 1110, Calculus…"
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-6 pr-2 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink"
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
        <p className="t-meta italic">No courses found</p>
      )}

      {!loading && !error && results.length === 0 && !query && (
        <p className="t-meta">Type a course code or name to search</p>
      )}

      <div ref={containerRef} className="flex flex-col gap-1.5 overflow-y-auto">
        {!loading &&
          !error &&
          results.map((course) => {
            const hasPrereqs = course.prereq_expr !== null;
            const met = hasPrereqs
              ? evaluatePrereq(course.prereq_expr, completedIds, completedCodes)
              : null;
            return <CourseChip key={course.id} course={course} prereqsMet={met} />;
          })}
      </div>
    </div>
  );
}
