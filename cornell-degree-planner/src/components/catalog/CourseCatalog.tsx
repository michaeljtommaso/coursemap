import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { animate, stagger } from "animejs";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { dragState } from "@/lib/drag/dragState";
import { usePlannerStore } from "@/store/usePlannerStore";
import { evaluatePrereq, buildCompletedSets } from "@/lib/planner/evaluatePrereq";
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
        "relative cursor-grab rounded-md border px-2 py-1.5 text-[10px] select-none",
        "transition-colors active:cursor-grabbing",
        prereqsMet === false
          ? "border-border bg-muted/60 opacity-60 hover:opacity-90"
          : "border-border bg-card hover:border-amber-300 hover:bg-amber-50 dark:hover:border-amber-700 dark:hover:bg-amber-950/30",
        isDraggingThis && "opacity-30"
      )}
    >
      {prereqsMet === true && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400"
          title="Prerequisites met"
        />
      )}
      {prereqsMet === false && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gray-400"
          title="Prerequisites not met"
        />
      )}
      <span className="font-semibold text-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
        {course.title}
      </span>
    </div>
  );
}

export function CourseCatalog({ slots }: { slots: ProgramSlotWithData[] }) {
  const [query, setQuery] = useState("");
  const { results, loading } = useCourseSearch(query);

  const completedSlotIds = usePlannerStore((s) => s.completedSlotIds);
  const slotSelections = usePlannerStore((s) => s.slotSelections);
  const selectedCourses = usePlannerStore((s) => s.selectedCourses);

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
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Course Catalog
        </p>
        <p className="mb-3 text-[10px] text-muted-foreground">
          Search and drag courses to elective slots
        </p>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CS 1110, Calculus…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-6 pr-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {loading && (
        <p className="text-[10px] text-muted-foreground">Searching…</p>
      )}

      {!loading && results.length === 0 && query && (
        <p className="text-[10px] italic text-muted-foreground">No courses found</p>
      )}

      {!loading && results.length === 0 && !query && (
        <p className="text-[10px] text-muted-foreground">
          Type a course code or name to search
        </p>
      )}

      <div ref={containerRef} className="flex flex-col gap-1.5 overflow-y-auto">
        {results.map((course) => {
          const hasPrereqs = course.prereq_expr !== null;
          const met = hasPrereqs
            ? evaluatePrereq(course.prereq_expr, completedIds, completedCodes)
            : null;
          return (
            <CourseChip key={course.id} course={course} prereqsMet={met} />
          );
        })}
      </div>
    </div>
  );
}
