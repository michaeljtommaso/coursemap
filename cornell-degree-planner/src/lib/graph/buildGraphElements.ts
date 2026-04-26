import type { Edge, Node } from "@xyflow/react";
import type { ProgramMap } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";
import { evaluateNodeStatus } from "./evaluateNodeStatus";

// Keep in sync with GRAPH_X_ORIGIN / GRAPH_X_SPACING in RoadmapCanvas.tsx
const X_ORIGIN = 140;
const X_SPACING = 280;
const Y_CENTER = 300;
const Y_SPACING = 160;

export function buildGraphElements(program: ProgramMap, plan: PlanState) {
  const nodesBySemester = new Map<number, typeof program.nodes>();
  program.nodes.forEach((node) => {
    const bucket = nodesBySemester.get(node.semesterHint) ?? [];
    bucket.push(node);
    nodesBySemester.set(node.semesterHint, bucket);
  });

  const nodes: Node[] = program.nodes.map((node) => {
    const semesterNodes = nodesBySemester.get(node.semesterHint)!;
    const indexInSemester = semesterNodes.indexOf(node);
    const totalInSemester = semesterNodes.length;
    const yOffset = ((totalInSemester - 1) * Y_SPACING) / 2;

    return {
      id: node.id,
      type: node.type,
      position: {
        x: X_ORIGIN + (node.semesterHint - 1) * X_SPACING,
        y: Y_CENTER - yOffset + indexInSemester * Y_SPACING,
      },
      data: {
        ...node,
        status: evaluateNodeStatus(node, plan),
      },
    };
  });

  const edges: Edge[] = program.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    animated: edge.type === "recommended",
    label: edge.type,
    style:
      edge.type === "prerequisite"
        ? { strokeWidth: 2 }
        : edge.type === "corequisite"
          ? { strokeDasharray: "5 5", strokeWidth: 2 }
          : { strokeDasharray: "3 6", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}
