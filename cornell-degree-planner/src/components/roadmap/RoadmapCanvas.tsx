import { useCallback, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useSlotStatus } from "@/hooks/useSlotStatus";
import { useHorizonMap } from "@/hooks/useHorizonMap";
import { useDerivedEdges } from "@/hooks/useDerivedEdges";
import { groupSlotsBySemester } from "@/lib/planner/semesters";
import { buildUnlocksMap } from "@/lib/planner/unlocks";
import { SemesterColumn } from "@/components/roadmap/SemesterColumn";
import { EdgeLayer, type EdgePulse } from "@/components/roadmap/EdgeLayer";
import { UnlocksGhosts } from "@/components/roadmap/UnlocksGhosts";
import { UnlocksContext } from "@/contexts/UnlocksContext";
import { HorizonContext } from "@/contexts/HorizonContext";
import { FirstRun } from "@/components/roadmap/FirstRun";
import { ZoomControl } from "@/components/roadmap/ZoomControl";
import { CanvasSlotSkeleton } from "@/components/ui/skeleton";
import type { ProgramSlotWithData } from "@/types/db";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * RoadmapCanvas (spec 004 §1) — real CSS columns instead of absolute pixel
 * math. The scroll container owns horizontal travel (scrollbar-gutter keeps
 * layout stable); the content element is the coordinate space the EdgeLayer
 * measures against; SemesterColumns are real DOM, so cards flex to their
 * content and sticky headers come for free.
 */

export function RoadmapCanvas({ slots, hiddenBySem, loading, error, onRetry }: {
  slots: ProgramSlotWithData[];
  hiddenBySem: Map<number, ProgramSlotWithData[]>;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { enteringYear } = useAuth();
  const zoom = usePlannerStore((s) => s.zoom);
  const { index, aliases } = useCatalogContext();

  // The ONE unified engine (spec 006 §B.2) — every canvas surface reads its
  // slot state and per-column credit totals from here.
  const { statusMap, semesterCredits } = useSlotStatus(slots);

  // Time-horizon overlay (spec 012) — near/far per column + near-column time
  // conflicts, delivered to cards via HorizonContext so computeSlotStatusMap
  // stays untouched. Empty (all "far") until enrollmentTarget + enteringYear
  // are both known, so today's face is the honest default.
  const horizonMap = useHorizonMap(slots);

  // Authored edges are dead (spec 008 §2b): the canvas derives its wires from
  // the placed courses' real prereq/coreq trees. `placements` feeds the hover-
  // unlocks layer too, so the two views share one truth.
  const { edges, placements } = useDerivedEdges(slots);

  // Forward "unlocks" reverse index (spec 008 §3a) — built once per catalog load.
  // NOTE (spec 008 §6): live index records lack `unlocks` until a gated re-index,
  // so this map is empty against live data today (ghosts + the card count show
  // nothing); it lights up once the index carries unlocks.
  const unlocksMap = useMemo(() => buildUnlocksMap(index, aliases), [index, aliases]);
  const recordById = useMemo(
    () => new Map<string, CatalogIndexRecord>(index.map((r) => [r.id, r])),
    [index]
  );

  const groups = useMemo(() => groupSlotsBySemester(slots), [slots]);

  // ── EdgeLayer plumbing: ref registry + hover chain + completion pulse ──────
  const registryRef = useRef<Map<string, HTMLElement>>(new Map());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const registerRef = useCallback((slotId: string, el: HTMLElement | null) => {
    if (el) registryRef.current.set(slotId, el);
    else registryRef.current.delete(slotId);
    setLayoutVersion((v) => v + 1);
  }, []);

  const [hoverSlotId, setHoverSlotId] = useState<string | null>(null);
  const hoverRaf = useRef(0);
  const onChainHover = useCallback((slotId: string | null) => {
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => setHoverSlotId(slotId));
  }, []);

  const [pulse, setPulse] = useState<EdgePulse>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleted = useCallback((slotId: string) => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setPulse({ slotId, key: Date.now() });
    pulseTimer.current = setTimeout(() => setPulse(null), 950);
  }, []);

  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

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
      <div
        data-canvas-scroll
        className="absolute inset-0 overflow-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          ref={setContentEl}
          className="relative min-h-full min-w-max px-6 py-4"
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
          <EdgeLayer
            edges={edges}
            registry={registryRef.current}
            contentEl={contentEl}
            layoutVersion={layoutVersion}
            scale={zoom}
            hoverSlotId={hoverSlotId}
            pulse={pulse}
          />
          {/* Hover-revealed forward unlocks (spec 008 §3b) — a sibling of the
              EdgeLayer inside the SAME zoomed content div, so it shares the
              content-space coordinate system. */}
          <UnlocksGhosts
            hoverSlotId={hoverSlotId}
            placements={placements}
            registry={registryRef.current}
            contentEl={contentEl}
            scale={zoom}
            layoutVersion={layoutVersion}
            unlocksMap={unlocksMap}
            recordById={recordById}
            onSustainHover={onChainHover}
          />
          {/* SlotCard reads the quiet "unlocks N" count from here (spec 008 §3b)
              and its near-horizon face from HorizonContext (spec 012). */}
          <UnlocksContext.Provider value={unlocksMap}>
           <HorizonContext.Provider value={horizonMap}>
            <div className="relative flex gap-10">
              {groups.map((group) => (
                <SemesterColumn
                  key={group.sem}
                  group={group}
                  hidden={hiddenBySem.get(group.sem) ?? []}
                  enteringYear={enteringYear}
                  statusMap={statusMap}
                  semesterCredits={semesterCredits}
                  registerRef={registerRef}
                  onChainHover={onChainHover}
                  onCompleted={onCompleted}
                />
              ))}
            </div>
           </HorizonContext.Provider>
          </UnlocksContext.Provider>
        </div>
      </div>
      <ZoomControl />
    </>
  );
}
