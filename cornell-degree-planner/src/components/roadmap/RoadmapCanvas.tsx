import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProgramMap } from "@/hooks/useProgramMap";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useThemeStore } from "@/store/useThemeStore";
import { buildRoadmapGrid } from "@/lib/graph/buildRoadmapGrid";
import { SemHeaderNode } from "@/components/roadmap/SemHeaderNode";
import { GridSlotNode } from "@/components/roadmap/GridSlotNode";

const nodeTypes = {
  semHeader: SemHeaderNode,
  gridSlot: GridSlotNode,
};

export function RoadmapCanvas() {
  const program = useProgramMap();
  const completed = usePlannerStore((s) => s.completed);
  const planned = usePlannerStore((s) => s.planned);
  const plannedSlots = usePlannerStore((s) => s.plannedSlots);
  const waived = usePlannerStore((s) => s.waived);
  const theme = useThemeStore((s) => s.theme);

  const plan = useMemo(
    () => ({ completed, planned, plannedSlots, waived }),
    [completed, planned, plannedSlots, waived]
  );

  const { nodes, edges } = useMemo(() => {
    if (!program) return { nodes: [], edges: [] };
    return buildRoadmapGrid(program, plan);
  }, [program, plan]);

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Interactive roadmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[680px] overflow-hidden rounded-2xl border border-border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            colorMode={theme}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
