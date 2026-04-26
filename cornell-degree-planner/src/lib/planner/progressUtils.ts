import type { ProgramMap } from "@/types/curriculum";
import type { PlanState } from "@/types/planner";

export function buildCategoryProgress(program: ProgramMap, plan: PlanState) {
  const categoryMap = new Map<string, { total: number; completed: number }>();

  program.nodes.forEach((node) => {
    node.categories.forEach((category) => {
      const existing = categoryMap.get(category) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (plan.completed.includes(node.id) || plan.waived.includes(node.id)) {
        existing.completed += 1;
      }
      categoryMap.set(category, existing);
    });
  });

  return Array.from(categoryMap.entries()).map(([category, value]) => ({
    category,
    total: value.total,
    completed: value.completed,
  }));
}
