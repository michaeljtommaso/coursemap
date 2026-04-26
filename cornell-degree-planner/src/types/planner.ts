export type PlannerTerm = {
  id: string;
  label: string;
  season: "fall" | "spring";
};

export type PlanState = {
  completed: string[];
  planned: Record<string, string>;       // nodeId → termId
  plannedSlots: Record<string, string>;  // "termId:slot" → nodeId
  waived: string[];
};
