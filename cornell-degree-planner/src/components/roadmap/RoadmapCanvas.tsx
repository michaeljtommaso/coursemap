import { useMemo } from "react";
import { RotateCw } from "lucide-react";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildRoadmapGrid, CARD_W, CARD_H, type GridEdge } from "@/lib/graph/buildRoadmapGrid";
import { computePrereqStatusMap } from "@/lib/planner/evaluatePrereq";
import { SemHeaderNode } from "@/components/roadmap/SemHeaderNode";
import { GridSlotNode } from "@/components/roadmap/GridSlotNode";
import { CanvasSlotSkeleton } from "@/components/ui/skeleton";
import type { ProgramSlotWithData, SlotEdge } from "@/types/db";

function EdgeLayer({ gridEdges, posMap }: {
  gridEdges: GridEdge[];
  posMap: Map<string, { x: number; y: number }>;
}) {
  return (
    <>
      {gridEdges.map((edge) => {
        const from = posMap.get(edge.fromId);
        const to = posMap.get(edge.toId);
        if (!from || !to) return null;

        const x1 = from.x + CARD_W;
        const y1 = from.y + CARD_H / 2;
        const x2 = to.x;
        const y2 = to.y + CARD_H / 2;
        const dx = Math.abs(x2 - x1) * 0.45;

        const strokeDasharray =
          edge.edgeType === "coreq"
            ? "5 5"
            : edge.edgeType === "sequence"
              ? "3 6"
              : undefined;

        return (
          <path
            key={edge.id}
            d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke="currentColor"
            className={
              edge.edgeType === "prereq"
                ? "text-line-strong opacity-70"
                : "text-line-strong opacity-40"
            }
            strokeWidth={edge.edgeType === "prereq" ? 2 : 1.5}
            strokeDasharray={strokeDasharray}
          />
        );
      })}
    </>
  );
}

export function RoadmapCanvas({ slots, edges, loading, error, onRetry }: {
  slots: ProgramSlotWithData[];
  edges: SlotEdge[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const completedSlotIds = usePlannerStore((s) => s.completedSlotIds);
  const slotSelections = usePlannerStore((s) => s.slotSelections);
  const selectedCourses = usePlannerStore((s) => s.selectedCourses);

  const prereqStatusMap = useMemo(
    () => computePrereqStatusMap(slots, completedSlotIds, slotSelections, selectedCourses),
    [slots, completedSlotIds, slotSelections, selectedCourses]
  );

  const { nodes, gridEdges, canvasWidth, canvasHeight } = useMemo(
    () => buildRoadmapGrid(slots, edges),
    [slots, edges]
  );

  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    nodes.forEach((n) => m.set(n.id, { x: n.x, y: n.y }));
    return m;
  }, [nodes]);

  return (
    <div className="absolute inset-0 overflow-auto">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive-tint px-5 py-4">
            <p className="t-body font-semibold text-destructive-text">
              Couldn&apos;t load the roadmap
            </p>
            <p className="t-meta text-destructive-text/80">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 t-label text-destructive-text transition-colors hover:bg-destructive/10"
              >
                <RotateCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        </div>
      ) : loading ? (
        <CanvasSlotSkeleton />
      ) : (
        <div
          style={{
            position: "relative",
            width: canvasWidth,
            height: canvasHeight,
            minWidth: "100%",
            minHeight: "100%",
            backgroundImage:
              "radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {/* SVG edge layer — rendered below nodes */}
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: canvasWidth,
              height: canvasHeight,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <EdgeLayer gridEdges={gridEdges} posMap={posMap} />
          </svg>

          {/* Nodes */}
          {nodes.map((node) => (
            <div
              key={node.id}
              style={{ position: "absolute", left: node.x, top: node.y }}
            >
              {node.type === "semHeader" ? (
                <SemHeaderNode data={node.data as Parameters<typeof SemHeaderNode>[0]["data"]} />
              ) : (
                <GridSlotNode
                  data={node.data as Parameters<typeof GridSlotNode>[0]["data"]}
                  prereqStatus={prereqStatusMap[node.id] ?? null}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!selectedProgramId && !loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-3">
          <p className="t-body font-medium">Load a program template to begin.</p>
          <p className="t-meta">Use the &ldquo;Load Template&rdquo; menu in the top right.</p>
        </div>
      )}
    </div>
  );
}
