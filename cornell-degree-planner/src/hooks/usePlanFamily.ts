import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { programFamily, type ProgramFamily } from "@/lib/planner/colleges";

/** The engine family of the plan on screen (spec 019 D3): the loaded plan's
 *  program, else the selection, as useRequirementProgress reads it. */
export function usePlanFamily(): ProgramFamily {
  const { planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs } = usePrograms();
  const id = planProgramId ?? selectedProgramId;
  return programFamily(programs.find((p) => p.id === id));
}
