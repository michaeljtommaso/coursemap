import type { RequirementNode } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";

export function getNodeById(nodes: RequirementNode[], id: string | null) {
  if (!id) return null;
  return nodes.find((node) => node.id === id) ?? null;
}

export function getCoursesForTerm(nodes: RequirementNode[], plan: PlanState, termId: string) {
  return nodes.filter((node) => plan.planned[node.id] === termId);
}
