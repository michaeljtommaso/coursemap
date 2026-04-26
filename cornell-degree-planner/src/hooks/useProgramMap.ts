import { useProgramStore } from "@/store/useProgramStore";
import { programRegistry } from "@/data/programs/index";

export function useProgramMap() {
  const selectedProgramId = useProgramStore((state) => state.selectedProgramId);
  if (!selectedProgramId) return null;
  return programRegistry[selectedProgramId] ?? null;
}
