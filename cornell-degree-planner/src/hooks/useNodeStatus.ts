import { useMemo } from "react";
import { useProgramMap } from "@/hooks/useProgramMap";
import { usePlannerStore } from "@/store/usePlannerStore";
import { evaluateNodeStatus } from "@/lib/graph/evaluateNodeStatus";

export function useNodeStatuses() {
  const program = useProgramMap();
  const completed = usePlannerStore((state) => state.completed);
  const planned = usePlannerStore((state) => state.planned);
  const plannedSlots = usePlannerStore((state) => state.plannedSlots);
  const waived = usePlannerStore((state) => state.waived);

  return useMemo(() => {
    if (!program) return {};
    const plan = { completed, planned, plannedSlots, waived };
    return Object.fromEntries(
      program.nodes.map((node) => [node.id, evaluateNodeStatus(node, plan)])
    );
  }, [program, completed, planned, plannedSlots, waived]);
}
