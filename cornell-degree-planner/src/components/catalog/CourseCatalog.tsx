import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { Search, RotateCw, Info, Columns } from "lucide-react";
import { animate, stagger } from "animejs";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useCourseFilters, type CourseFilters } from "@/hooks/useCourseFilters";
import { dragState } from "@/lib/drag/dragState";
import { useDragSource } from "@/hooks/useDragSource";
import { usePlan } from "@/hooks/usePlan";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildCompletedSets } from "@/lib/planner/evaluatePrereq";
import { evaluate } from "@/lib/planner/satisfies";
import { buildCreditCourses } from "@/lib/planner/creditPool";
import { formatCredits } from "@/lib/planner/semesters";
import { buildUnlocksMap } from "@/lib/planner/unlocks";
import { CatalogChipSkeleton } from "@/components/ui/skeleton";
import { CatalogFilterChips } from "@/components/catalog/CatalogFilterChips";
import { FavoriteStar } from "@/components/course/FavoriteStar";
import { useAuth } from "@/contexts/AuthProvider";
import { cn } from "@/lib/utils";
import type { BoardCard } from "@/lib/planner/board";
import type { Course, ProgramSlotWithData } from "@/types/db";

/** met/advisory/blocked mirrors satisfies.EvalResult's state exactly; null =
 *  no prereq expr to evaluate (course-detail doc hasn't landed, or the course
 *  truly has none). */
type PrereqChipState = "met" | "advisory" | "blocked" | null;

function CourseChip({
  course,
  state,
  unlockN,
}: {
  course: Course;
  state: PrereqChipState;
  /** How many other courses this one unlocks (spec 013 §1) — "→ N" when > 0. */
  unlockN: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A catalog drag of THIS course is in flight (board-card drags of the same
  // course don't dim the row).
  const isDraggingThis = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    return !!s && s.phase === "dragging" && s.sourcePlacementId === null && s.courseId === course.id;
  });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    // Lift only — no scale: a scaled chip overflows the drawer's overflow-y
    // scroll box sideways and gets clipped against the drawer edge (an
    // overflow-y:auto box clips horizontally too). Depth comes from the CSS
    // hover shadow instead. Timing eased off (170/200) so the lift reads
    // calm, not snappy.
    const onEnter = () => {
      if (!dragState.get()) animate(el, { y: -2, duration: 170, ease: "out(3)" });
    };
    const onLeave = () => animate(el, { y: 0, duration: 200, ease: "out(2)" });
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
  const { favoriteCourseIds, pinnedCourseIds, togglePin } = useAuth();
  const isFav = favoriteCourseIds.includes(course.id);
  const isPinned = pinnedCourseIds.includes(course.id);
  const isArmed = armedCourse?.id === course.id;

  // Drag start (spec 014 §D3/§D7): the SAME shared hook the board cards use —
  // a 6px threshold watched by document listeners (mouse), a ~250ms hold
  // (touch). A plain click (or tap) ARMS the course for click-to-place instead.
  // The hook never preventDefaults pointerdown, so the list still touch-scrolls.
  const { onPointerDown: handlePointerDown } = useDragSource({
    onStart: ({ x, y }) => {
      disarm();
      const r = ref.current?.getBoundingClientRect();
      dragState.start({
        course,
        sourcePlacementId: null,
        startX: x,
        startY: y,
        originRect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
        sourceEl: ref.current ?? null,
      });
    },
  });
  const handleClick = () => {
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
      data-catalog-course={course.id}
      role="button"
      tabIndex={0}
      aria-label={`${label}, ${course.title}${state === "blocked" ? ", prerequisites not yet covered" : state === "advisory" ? ", may be satisfied by credit" : ""}. ${isArmed ? "Armed — click a semester on the roadmap to add it, or press Escape." : "Press Enter to arm it for placing, or drag it onto a semester."}`}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ touchAction: "pan-y" }}
      // Unified state vocabulary (spec 006/007 §B.1/§B.3, triage #10): red/
      // destructive tint = "you can't take this yet" (unmet HARD prereqs, same
      // treatment as the canvas's blocked state), subtle green = met, neutral
      // ink = advisory ("usually needs this, may already be covered"). A
      // catalog course has no semester so offeredOk/coreq-concurrent don't
      // apply here — this stays a prereq-only check against the current plan.
      title={state === "blocked" ? "Prerequisites not yet met" : undefined}
      className={cn(
        "drag-source group relative cursor-grab rounded-md border px-2 py-1.5 select-none",
        // Transition colors + shadow ONLY — never transform: anime.js owns the
        // lift, and a CSS transform transition fights it (double-eased hover).
        "transition-[color,background-color,border-color,box-shadow] duration-200 active:cursor-grabbing hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
        state === "blocked"
          ? "border-destructive/30 bg-destructive-tint/70 hover:border-destructive/50 hover:bg-destructive-tint"
          : "border-line bg-surface hover:border-complete hover:bg-complete-tint",
        isArmed && "border-[1.5px] border-drop bg-drop-tint opacity-100",
        isDraggingThis && "opacity-30"
      )}
    >
      {state === "met" && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-complete"
          title="Prerequisites met"
        />
      )}
      {state === "blocked" && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive"
          title="Prerequisites not met"
        />
      )}
      {state === "advisory" && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink-3"
          title="Usually needs earlier coursework — may be satisfied by credit"
        />
      )}
      <span className="flex items-baseline justify-between gap-1.5 pr-2.5">
        <span
          className={cn(
            "t-label normal-case tracking-normal",
            state === "blocked" ? "text-destructive-text" : "text-ink"
          )}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          {/* Unlocks signal (spec 013 §1) — "→ N" glanceable fact, no chrome.
              Only when N>0; title-attributed for the full sentence. */}
          {unlockN > 0 && (
            <span
              className="t-meta text-ink-3"
              title={`Unlocks ${unlockN} later ${unlockN === 1 ? "course" : "courses"}`}
            >
              <span className="num">→ {unlockN}</span>
            </span>
          )}
          {credits && (
            <span className="t-meta text-ink-3">
              <span className="num">{credits}</span> cr
            </span>
          )}
        </span>
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
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(any-hover:none)]:opacity-100"
          )}
        />
        {/* Compare (spec 013 §1) — the row's secondary action: pin this course
            to the decision hub's compare tray (persisted like a favorite). */}
        <button
          onClick={(e) => { e.stopPropagation(); togglePin(course.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={isPinned ? `Remove ${label} from compare` : `Add ${label} to compare`}
          aria-pressed={isPinned}
          title={isPinned ? "In your compare tray" : "Compare"}
          className={cn(
            "inline-flex items-center rounded p-0.5 transition-opacity hover:text-ink focus-visible:opacity-100",
            isPinned
              ? "text-drop-text opacity-100"
              : "text-ink-4 opacity-0 group-hover:opacity-100 [@media(any-hover:none)]:opacity-100"
          )}
        >
          <Columns className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); openCourseDetail(course); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Details for ${label}`}
          title="Course details"
          className="inline-flex items-center rounded p-0.5 text-ink-4 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(any-hover:none)]:opacity-100"
        >
          <Info className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

export function CourseCatalog({
  cards,
  templateSlots,
}: {
  /** useBoard's cards (one per placement) — the completed pool. */
  cards: BoardCard[];
  /** The program's template slots — the "For my major" discovery filter. */
  templateSlots: ProgramSlotWithData[];
}) {
  // A pending seed present at mount (the drawer opened by "Find a class")
  // becomes the initial query; later seeds arrive through the subscription below.
  const [query, setQuery] = useState(() => usePlannerStore.getState().catalogSeed ?? "");
  const [filters, setFilters] = useState<CourseFilters>(() =>
    usePlannerStore.getState().catalogSeed != null ? (usePlannerStore.getState().catalogFilterSeed ?? {}) : {}
  );
  const { courseDetails, ensureCourseDetails, index, aliases } = useCatalogContext();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { favoriteCourseIds, creditProfile } = useAuth();
  const favorites = useMemo(() => new Set(favoriteCourseIds), [favoriteCourseIds]);
  // Credit profile (spec 007 §2/§6, Unit 7C2) — memoized once per drawer
  // render so chips agree with the card/panel's engine-computed states.
  const creditCourses = useMemo(() => buildCreditCourses(creditProfile), [creditProfile]);

  // Unlocks map (spec 013 §1) — the drawer lives OUTSIDE RoadmapCanvas's
  // UnlocksContext provider, so it reads the same reverse index straight from
  // the catalog index/aliases here, memoized once per index load (never a scan).
  const unlocksMap = useMemo(() => buildUnlocksMap(index, aliases), [index, aliases]);
  // Cross-listed twins satisfy each other's leaves, as on the card and panel.
  const canonical = useMemo(() => (id: string) => aliases[id] ?? id, [aliases]);

  // Shared filter model (spec 006 §E3) — same predicate the /classes page uses.
  const { predicate, hasOffered } = useCourseFilters(index, templateSlots, { favorites });
  const { results, loading, error, refetch } = useCourseSearch(query, filters, predicate);

  // Consume a pending catalog seed (spec 006 §D3): an empty slot's "＋ Find a
  // class" opens the drawer pre-filtered to its rule. Apply once, then clear.
  // Attribute slots (spec 010 §2) additionally carry a filter seed (e.g. the FWS
  // attribute) — a Find-a-class always starts from a clean filter state matching
  // the slot, so a stale filter never over-constrains the next targeted search.
  useEffect(() => {
    // The mount-time seed was taken as initial state; clear it so it applies once.
    if (usePlannerStore.getState().catalogSeed != null) usePlannerStore.getState().clearCatalogSeed();
    return usePlannerStore.subscribe((s) => {
      if (s.catalogSeed == null) return;
      setQuery(s.catalogSeed);
      setFilters(s.catalogFilterSeed ?? {});
      s.clearCatalogSeed();
    });
  }, []);

  const { completedIds: completedPlacementIds } = usePlan();

  const { completedIds, completedCodes } = useMemo(
    () => buildCompletedSets(cards, completedPlacementIds),
    [cards, completedPlacementIds]
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
          Find a course, then drag it onto a semester — or tap it, then tap where it goes.
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

      {/* -m/p headroom: the scroll box clips at its padding edge, so without it
          a lifted top chip (y:-2) and hover shadows shear off at the borders. */}
      <div ref={containerRef} className="-mx-1 -mt-1 flex flex-col gap-1.5 overflow-y-auto px-1 pt-1 pb-1">
        {!loading &&
          !error &&
          results.map((course) => {
            // Real prereq_expr lives on the full doc (courseDetails), not the
            // search-index record. null until the doc is cached → neutral chip.
            // satisfies.evaluate (spec 007 §6) folds the credit profile in, so
            // met/advisory/blocked here never disagrees with the card/panel.
            const expr = courseDetails[course.id]?.prereq_expr ?? null;
            const state = expr
              ? evaluate(expr, {
                  completedIds,
                  completedCodes,
                  creditIds: creditCourses.ids,
                  creditCodes: creditCourses.codes,
                  canonical,
                }).state
              : null;
            return (
              <CourseChip
                key={course.id}
                course={course}
                state={state}
                unlockN={unlocksMap.get(course.id)?.length ?? 0}
              />
            );
          })}
      </div>
    </div>
  );
}
