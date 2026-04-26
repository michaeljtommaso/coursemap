import type { RequirementNode, NodeStatus } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";

export function evaluateNodeStatus(node: RequirementNode, plan: PlanState): NodeStatus {
  if (plan.waived.includes(node.id)) return "waived";
  if (plan.completed.includes(node.id)) return "completed";
  if (plan.planned[node.id]) return "planned";

  const prereqs = node.prereqNodeIds ?? [];
  const prereqsSatisfied = prereqs.every(
    (id) =>
      plan.completed.includes(id) ||
      plan.waived.includes(id) ||
      Boolean(plan.planned[id])
  );

  return prereqsSatisfied ? "available" : "locked";
}
