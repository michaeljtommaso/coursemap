import { useCallback, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { computePrereqStatusMap } from "@/lib/planner/evaluatePrereq";
import { groupSlotsBySemester } from "@/lib/planner/semesters";
import { SemesterColumn } from "@/components/roadmap/SemesterColumn";
import { EdgeLayer, type EdgePulse } from "@/components/roadmap/EdgeLayer";
import { FirstRun } from "@/components/roadmap/FirstRun";
import { CanvasSlotSkeleton } from "@/components/ui/skeleton";
import type { ProgramSlotWithData, SlotEdge } from "@/types/db";

/**
 * RoadmapCanvas (spec 004 §1) — real CSS columns instead of absolute pixel
 * math. The scroll container owns horizontal travel (scrollbar-gutter keeps
 * layout stable); the content element is the coordinate space the EdgeLayer
 * measures against; SemesterColumns are real DOM, so cards flex to their
 * content and sticky headers come for free.
 */

export function RoadmapCanvas({ slots, edges, loading, error, onRetry }: {
  slots: ProgramSlotWithData[];
  edges: SlotEdge[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();
  const { enteringYear } = useAuth();

  const prereqStatusMap = useMemo(
    () => computePrereqStatusMap(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
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

  return (
    <div
      data-canvas-scroll
      className="absolute inset-0 overflow-auto"
      style={{ scrollbarGutter: "stable" }}
    >
      <div
        ref={setContentEl}
        className="relative min-h-full min-w-max px-6 py-4"
        style={{
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
          hoverSlotId={hoverSlotId}
          pulse={pulse}
        />
        <div className="relative flex gap-10">
          {groups.map((group) => (
            <SemesterColumn
              key={group.sem}
              group={group}
              enteringYear={enteringYear}
              prereqStatusMap={prereqStatusMap}
              registerRef={registerRef}
              onChainHover={onChainHover}
              onCompleted={onCompleted}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
