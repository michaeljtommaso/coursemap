import type { Edge, Node } from "@xyflow/react";
import type { ProgramMap } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";
import { plannerTerms, SLOTS_PER_TERM } from "@/data/terms";
import { evaluateNodeStatus } from "./evaluateNodeStatus";

export const CARD_W = 200;
export const CARD_H = 90;
const COL_STRIDE = 244;
const HEADER_H = 48;
const ROW_STRIDE = 104;
const X_OFFSET = 20;
const Y_OFFSET = 20;
const SLOT_Y_START = Y_OFFSET + HEADER_H + 14;

export function buildRoadmapGrid(program: ProgramMap, plan: PlanState) {
  const nodes: Node[] = [];
  const nodeToSlotId = new Map<string, string>();

  plannerTerms.forEach((term, colIdx) => {
    const x = X_OFFSET + colIdx * COL_STRIDE;

    nodes.push({
      id: `sem-header-${term.id}`,
      type: "semHeader",
      position: { x, y: Y_OFFSET },
      data: { label: term.label, semNum: colIdx + 1, season: term.season },
      draggable: false,
      selectable: false,
    });

    for (let slotIdx = 0; slotIdx < SLOTS_PER_TERM; slotIdx++) {
      const slotKey = `${term.id}:${slotIdx}`;
      const nodeId = plan.plannedSlots[slotKey] ?? null;
      const course = nodeId ? (program.nodes.find((n) => n.id === nodeId) ?? null) : null;
      const status = course ? evaluateNodeStatus(course, plan) : null;
      const slotNodeId = `grid-slot-${slotKey}`;

      if (nodeId) nodeToSlotId.set(nodeId, slotNodeId);

      nodes.push({
        id: slotNodeId,
        type: "gridSlot",
        position: { x, y: SLOT_Y_START + slotIdx * ROW_STRIDE },
        data: { termId: term.id, slot: slotIdx, course, status },
        draggable: false,
        selectable: false,
      });
    }
  });

  const edges: Edge[] = [];
  program.edges.forEach((edge) => {
    const fromSlotId = nodeToSlotId.get(edge.from);
    const toSlotId = nodeToSlotId.get(edge.to);
    if (!fromSlotId || !toSlotId) return;
    edges.push({
      id: `grid-edge-${edge.id}`,
      source: fromSlotId,
      target: toSlotId,
      sourceHandle: "right",
      targetHandle: "left",
      animated: edge.type === "recommended",
      label: edge.type,
      style:
        edge.type === "prerequisite"
          ? { strokeWidth: 2 }
          : edge.type === "corequisite"
            ? { strokeDasharray: "5 5", strokeWidth: 2 }
            : { strokeDasharray: "3 6", strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}
