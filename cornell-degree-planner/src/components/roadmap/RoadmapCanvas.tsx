import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RotateCw } from "lucide-react";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useCardStatus } from "@/hooks/useCardStatus";
import { usePlan } from "@/hooks/usePlan";
import { shortTermGapSems } from "@/components/roadmap/boardColumns";
import { useHorizonMap } from "@/hooks/useHorizonMap";
import { useDerivedEdges } from "@/hooks/useDerivedEdges";
import { dragState } from "@/lib/drag/dragState";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { buildCardPrograms } from "./cardPrograms";
import { useMakeRoom } from "@/components/requirements/orphanPrune";
import type { MarkValue } from "@/lib/planner/distribution/types";
import { countsForKey } from "@/lib/planner/questions/keys";
import { buildUnlocksMap } from "@/lib/planner/unlocks";
import { SemesterColumn } from "@/components/roadmap/SemesterColumn";
import { EdgeLayer, type EdgePulse } from "@/components/roadmap/EdgeLayer";
import { UnlocksGhosts } from "@/components/roadmap/UnlocksGhosts";
import { FEATURES } from "@/config/features";
import { UnlocksContext } from "@/contexts/UnlocksContext";
import { ChainGlowContext, type ChainGlow } from "@/contexts/ChainGlowContext";
import { HorizonContext } from "@/contexts/HorizonContext";
import { FirstRun } from "@/components/roadmap/FirstRun";
import { ZoomControl } from "@/components/roadmap/ZoomControl";
import { CanvasSlotSkeleton } from "@/components/ui/skeleton";
import type { BoardCard, BoardColumn } from "@/hooks/useBoard";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * RoadmapCanvas (spec 004 §1) — real CSS columns instead of absolute pixel
 * math. The scroll container owns horizontal travel (scrollbar-gutter keeps
 * layout stable); the content element is the coordinate space the EdgeLayer
 * measures against; SemesterColumns are real DOM, so cards flex to their
 * content and sticky headers come for free.
 */

export function RoadmapCanvas({ columns, cards, loading, error, onRetry }: {
  /** useBoard's columns in time order (placements in order, every semester
   *  1–8 + used 9–10, plus the added short terms — spec 042). */
  columns: BoardColumn[];
  /** useBoard's cards — one per placement, what the engines evaluate. */
  cards: BoardCard[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { enteringYear } = useAuth();
  const zoom = usePlannerStore((s) => s.zoom);
  const { index, aliases } = useCatalogContext();

  // The ONE unified engine (spec 006 §B.2) — every canvas surface reads its
  // card state and per-column credit totals from here.
  const { statusMap, semesterCredits, pendingChoices } = useCardStatus(cards);

  // Time-horizon overlay (spec 012) — near/far per column + near-column time
  // conflicts, delivered to cards via HorizonContext so computeCardStatusMap
  // stays untouched. Empty (all "far") until enrollmentTarget + enteringYear
  // are both known, so today's face is the honest default.
  const horizonMap = useHorizonMap(cards);

  // Authored edges are dead (spec 008 §2b): the canvas derives its wires from
  // the placed courses' real prereq/coreq trees. `placements` feeds the hover-
  // unlocks layer too, so the two views share one truth.
  const { edges, placements } = useDerivedEdges(cards);

  // Forward "unlocks" reverse index (spec 008 §3a) — built once per catalog load.
  // NOTE (spec 008 §6): live index records lack `unlocks` until a gated re-index,
  // so this map is empty against live data today (ghosts + the card count show
  // nothing); it lights up once the index carries unlocks.
  const unlocksMap = useMemo(() => buildUnlocksMap(index, aliases), [index, aliases]);
  const recordById = useMemo(
    () => new Map<string, CatalogIndexRecord>(index.map((r) => [r.id, r])),
    [index]
  );

  // Requirement attribution (spec 014 §D1) — computed ONCE here and handed to
  // the cards ("counts toward" labels), not re-derived per card.
  const progress = useRequirementProgress();
  const { attribution } = progress;
  // Spec 047 D6/D8: each card's program dots and held-back line, built once
  // for the board ({} when the plan has no extra programs).
  const cardPrograms = useMemo(() => buildCardPrograms(progress), [progress]);
  // Spec 047 D10: the card menu's "Count it for X instead" writes a course
  // mark; prune orphaned answers first when that write would hit the cap.
  const makeRoom = useMakeRoom(progress);
  const beforeCountFor = useCallback(
    (courseId: string, layerId: string) => makeRoom("mark", countsForKey(layerId, courseId), "yes"),
    [makeRoom]
  );
  // The same guard for any other answer a card writes (its credits pick).
  const beforeMark = useCallback(
    (key: string, value: MarkValue | null) => makeRoom("mark", key, value),
    [makeRoom]
  );

  // ── EdgeLayer plumbing: ref registry + hover chain + completion pulse ──────
  // A stable Map instance (lazy state, never replaced) — mutated by
  // registerRef, read by the layers; layoutVersion signals the changes.
  const [registry] = useState(() => new Map<string, HTMLElement>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const registerRef = useCallback(
    (placementId: string, el: HTMLElement | null) => {
      if (el) registry.set(placementId, el);
      else registry.delete(placementId);
      setLayoutVersion((v) => v + 1);
    },
    [registry]
  );

  const [hoverPlacementId, setHoverPlacementId] = useState<string | null>(null);
  const hoverRaf = useRef(0);
  const onChainHover = useCallback((placementId: string | null) => {
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => setHoverPlacementId(placementId));
  }, []);

  // Hover glow: the hovered card plus every card its wires point to. Off while
  // a drag is in flight — the pointer crosses cards, and the glow would flicker
  // after it like the (hidden) wires would.
  const dragging = useSyncExternalStore(dragState.subscribe, () => dragState.get()?.phase === "dragging");
  const chainGlow = useMemo<ChainGlow>(() => {
    if (!hoverPlacementId || dragging) return { source: null, targets: new Set() };
    const targets = new Set<string>();
    for (const e of edges) if (e.fromPlacementId === hoverPlacementId) targets.add(e.toPlacementId);
    return { source: hoverPlacementId, targets };
  }, [edges, hoverPlacementId, dragging]);

  const [pulse, setPulse] = useState<EdgePulse>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleted = useCallback((placementId: string) => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setPulse({ placementId, key: Date.now() });
    pulseTimer.current = setTimeout(() => setPulse(null), 950);
  }, []);

  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  // Gap "+" buttons (spec 042 D2/D8): one before every semester column whose
  // gap has no short term yet — the first column included — while the plan is
  // under MAX_SHORT_TERMS (boardColumns.shortTermGapSems).
  const { shortTerms } = usePlan();
  const gapPlusSems = useMemo(
    () => shortTermGapSems(columns, shortTerms.length),
    [columns, shortTerms.length]
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive-tint px-5 py-4">
          <p className="t-body font-semibold text-destructive-text">
            We couldn&apos;t load your roadmap
          </p>
          <p className="t-meta text-destructive-text/80">
            Your plan is safe — this is just a connection hiccup.
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 t-label text-destructive-text transition-colors hover:bg-destructive/10"
            >
              <RotateCw className="h-3 w-3" />
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!selectedProgramId && !loading) {
    return <FirstRun />;
  }

  if (loading) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <CanvasSlotSkeleton />
      </div>
    );
  }

  const zoomed = zoom !== 1;

  return (
    <>
      {/* select-none (bug sweep D6): a press-drag anywhere on the board must
          never paint a text selection. The detail panel and dialogs live
          outside this subtree and stay selectable. */}
      <div
        data-canvas-scroll
        className="absolute inset-0 select-none overflow-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          ref={setContentEl}
          // pl-10: the gap before the first column is a full column gap, so
          // its "+" (the summer/winter before semester 1, spec 042 D8) has the
          // same room as every other gap.
          className="relative min-h-full min-w-max py-4 pl-10 pr-6"
          style={{
            // CSS `zoom` (standardized) instead of `transform: scale()`: zoom
            // scales LAYOUT, so scroll extents track for free and — unlike a
            // transform — it never becomes a containing block, which keeps the
            // columns' `sticky top-0` headers pinning (spec 006 §F2).
            zoom: zoomed ? zoom : undefined,
            backgroundImage:
              "radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {/* Overlay layers hide while a drag is in flight (globals.css
              .canvas-overlays): cards shift around the insertion outline and
              the in-flight card is hidden, so wires would point at stale or
              empty boxes. The wrapper is unpositioned, so the layers'
              absolute boxes still anchor to the content div. */}
          <div className="canvas-overlays">
          <EdgeLayer
            edges={edges}
            registry={registry}
            contentEl={contentEl}
            layoutVersion={layoutVersion}
            scale={zoom}
            hoverPlacementId={hoverPlacementId}
            pulse={pulse}
          />
          {/* Hover-revealed forward unlocks (spec 008 §3b) — a sibling of the
              EdgeLayer inside the SAME zoomed content div, so it shares the
              content-space coordinate system. Switched off for now
              (FEATURES.unlockSuggestions). */}
          {FEATURES.unlockSuggestions && (
          <UnlocksGhosts
            hoverPlacementId={hoverPlacementId}
            placements={placements}
            registry={registry}
            contentEl={contentEl}
            scale={zoom}
            layoutVersion={layoutVersion}
            unlocksMap={unlocksMap}
            recordById={recordById}
            onSustainHover={onChainHover}
          />
          )}
          </div>
          {/* CourseCard reads the quiet "unlocks N" count from here (spec 008 §3b)
              and its near-horizon face from HorizonContext (spec 012). */}
          <UnlocksContext.Provider value={unlocksMap}>
           <HorizonContext.Provider value={horizonMap}>
            <ChainGlowContext.Provider value={chainGlow}>
            <div className="relative flex gap-10">
              {columns.map((column) => (
                <SemesterColumn
                  // The time key: a short term and its semester share `sem`.
                  key={column.key}
                  column={column}
                  canAddShortTermBefore={!column.shortTerm && gapPlusSems.has(column.sem)}
                  enteringYear={enteringYear}
                  statusMap={statusMap}
                  pendingChoices={pendingChoices}
                  semesterCredits={semesterCredits}
                  registerRef={registerRef}
                  onChainHover={onChainHover}
                  onCompleted={onCompleted}
                  attribution={attribution}
                  cardPrograms={cardPrograms}
                  beforeCountFor={beforeCountFor}
                  beforeMark={beforeMark}
                />
              ))}
            </div>
            </ChainGlowContext.Provider>
           </HorizonContext.Provider>
          </UnlocksContext.Provider>
        </div>
      </div>
      <ZoomControl />
    </>
  );
}
