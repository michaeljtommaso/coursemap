import type { ProgramSlotWithData, SlotEdge } from "@/types/db";

export const CARD_W = 200;
export const CARD_H = 90;
const COL_STRIDE = 244;
const HEADER_H = 48;
const ROW_STRIDE = 104;
const X_OFFSET = 20;
const Y_OFFSET = 20;
const SLOT_Y_START = Y_OFFSET + HEADER_H + 14;

const SEM_LABELS: Record<number, string> = {
  1: "Fall · Freshman",
  2: "Spring · Freshman",
  3: "Fall · Sophomore",
  4: "Spring · Sophomore",
  5: "Fall · Junior",
  6: "Spring · Junior",
  7: "Fall · Senior",
  8: "Spring · Senior",
};
const SEM_SEASONS: Record<number, "fall" | "spring"> = {
  1: "fall", 2: "spring", 3: "fall", 4: "spring",
  5: "fall", 6: "spring", 7: "fall", 8: "spring",
};

export type GridNode = {
  id: string;
  type: "semHeader" | "gridSlot";
  x: number;
  y: number;
  data: Record<string, unknown>;
};

export type GridEdge = {
  id: string;
  fromId: string;
  toId: string;
  edgeType: "prereq" | "coreq" | "sequence";
};

export function buildRoadmapGrid(
  slots: ProgramSlotWithData[],
  edges: SlotEdge[]
): { nodes: GridNode[]; gridEdges: GridEdge[]; canvasWidth: number; canvasHeight: number } {
  const nodes: GridNode[] = [];

  const usedSems = slots.length
    ? [...new Set(slots.map((s) => s.suggested_semester))].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6, 7, 8];

  const semToCol = new Map(usedSems.map((sem, i) => [sem, i]));

  usedSems.forEach((sem) => {
    const col = semToCol.get(sem)!;
    nodes.push({
      id: `sem-header-${sem}`,
      type: "semHeader",
      x: X_OFFSET + col * COL_STRIDE,
      y: Y_OFFSET,
      data: {
        label: SEM_LABELS[sem] ?? `Semester ${sem}`,
        semNum: sem,
        season: SEM_SEASONS[sem] ?? "fall",
      },
    });
  });

  slots.forEach((slot) => {
    const col = semToCol.get(slot.suggested_semester) ?? 0;
    nodes.push({
      id: slot.id,
      type: "gridSlot",
      x: X_OFFSET + col * COL_STRIDE,
      y: SLOT_Y_START + slot.slot_row * ROW_STRIDE,
      data: { slot },
    });
  });

  const gridEdges: GridEdge[] = edges.map((edge) => ({
    id: edge.id,
    fromId: edge.from_slot,
    toId: edge.to_slot,
    edgeType:
      edge.edge_type === "prereq"
        ? "prereq"
        : edge.edge_type === "coreq" || edge.edge_type === "concurrent"
          ? "coreq"
          : "sequence",
  }));

  const numCols = usedSems.length;
  const canvasWidth = X_OFFSET + (numCols - 1) * COL_STRIDE + CARD_W + X_OFFSET * 2;
  const maxRow = slots.length > 0 ? Math.max(...slots.map((s) => s.slot_row)) : 4;
  const canvasHeight = SLOT_Y_START + (maxRow + 1) * ROW_STRIDE + Y_OFFSET * 2;

  return { nodes, gridEdges, canvasWidth, canvasHeight };
}
