import type { ProgramMap } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";
import type { PlannerWarning } from "@/types/graph";

export function buildPlannerWarnings(program: ProgramMap, plan: PlanState): PlannerWarning[] {
  const warnings: PlannerWarning[] = [];

  Object.entries(plan.planned).forEach(([nodeId]) => {
    const node = program.nodes.find((item) => item.id === nodeId);
    if (!node) return;

    const missingPrereqs = (node.prereqNodeIds ?? []).filter(
      (prereqId) =>
        !plan.completed.includes(prereqId) && !plan.waived.includes(prereqId)
    );

    if (missingPrereqs.length > 0) {
      warnings.push({
        id: `${nodeId}-missing-prereqs`,
        type: "prerequisite",
        message: `${node.code ?? node.title} is planned before all prerequisites are completed.`,
      });
    }
  });

  return warnings;
}
