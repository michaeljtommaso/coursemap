import { useCallback, useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramData } from "@/hooks/useProgramData";
import { concentrationChoice, type ConcentrationChoice } from "./programsModel";

/**
 * The plan's second major's concentration choice (spec 047 D2) and its
 * writer. Options and min/max come from the second major's program data —
 * the same session-cached ProgramProvider loader the primary's choice and
 * useAdditionalProgramData read, so this adds no read of its own. The choice
 * is stored on the plan entry (`setProgramConcentrations`). `choice` is null
 * with no second major, while its layers load, or when it offers no
 * concentrations.
 */
export function useSecondMajorConcentration(): {
  choice: ConcentrationChoice | null;
  choose: (ids: string[]) => void;
} {
  const { additionalPrograms, setProgramConcentrations } = usePlan();
  const { programs } = usePrograms();
  const second = additionalPrograms.find((p) => p.kind === "major") ?? null;
  const programId = second?.programId ?? null;
  const { layers } = useProgramData(programId);
  const shortName = programId ? (programs.find((p) => p.id === programId)?.short_name ?? programId) : "";
  const chosenKey = (second?.concentrationIds ?? []).join("\u0000");
  const choice = useMemo(
    () => (programId ? concentrationChoice(programId, shortName, layers, chosenKey ? chosenKey.split("\u0000") : []) : null),
    [programId, shortName, layers, chosenKey]
  );
  const choose = useCallback(
    (ids: string[]) => {
      if (programId) setProgramConcentrations(programId, ids);
    },
    [programId, setProgramConcentrations]
  );
  return { choice, choose };
}
