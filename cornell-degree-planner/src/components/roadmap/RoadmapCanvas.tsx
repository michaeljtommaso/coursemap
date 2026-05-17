import { useMemo } from "react";
import { useProgramStore } from "@/store/useProgramStore";
import { useThemeStore } from "@/store/useThemeStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildRoadmapGrid, CARD_W, CARD_H, type GridEdge } from "@/lib/graph/buildRoadmapGrid";
import { computePrereqStatusMap } from "@/lib/planner/evaluatePrereq";
import { SemHeaderNode } from "@/components/roadmap/SemHeaderNode";
import { GridSlotNode } from "@/components/roadmap/GridSlotNode";
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
                ? "text-border opacity-70"
                : "text-border opacity-40"
            }
            strokeWidth={edge.edgeType === "prereq" ? 2 : 1.5}
            strokeDasharray={strokeDasharray}
          />
        );
      })}
    </>
  );
}

export function RoadmapCanvas({ slots, edges, loading, error }: {
  slots: ProgramSlotWithData[];
  edges: SlotEdge[];
  loading: boolean;
  error: string | null;
}) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const theme = useThemeStore((s) => s.theme);
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

  const dotColor = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  return (
    <div className="absolute inset-0 overflow-auto">
      {error ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p className="text-sm">Loading roadmap…</p>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            width: canvasWidth,
            height: canvasHeight,
            minWidth: "100%",
            minHeight: "100%",
            backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
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

      {!selectedProgramId && !loading && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <p className="text-sm font-medium">Load a program template to begin.</p>
          <p className="text-xs">Use the "Load Template" menu in the top right.</p>
        </div>
      )}
    </div>
  );
}
