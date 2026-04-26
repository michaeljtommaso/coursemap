import { useMemo } from "react";
import { useProgramMap } from "@/hooks/useProgramMap";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildPlannerWarnings } from "@/lib/planner/plannerUtils";

export function usePlannerWarnings() {
  const program = useProgramMap();
  const completed = usePlannerStore((state) => state.completed);
  const planned = usePlannerStore((state) => state.planned);
  const plannedSlots = usePlannerStore((state) => state.plannedSlots);
  const waived = usePlannerStore((state) => state.waived);

  return useMemo(() => {
    if (!program) return [];
    return buildPlannerWarnings(program, { completed, planned, plannedSlots, waived });
  }, [program, completed, planned, plannedSlots, waived]);
}
