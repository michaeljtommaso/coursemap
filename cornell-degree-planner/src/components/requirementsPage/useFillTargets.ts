import { useCallback, useMemo } from "react";
import type { ProgramSlotWithData } from "@/types/db";
import type { RequirementItem } from "@/hooks/useRequirementProgress";
import { buildLayerRowPredicate, buildRequirementPredicate } from "@/hooks/useCourseFilters";
import { useProgramData } from "@/hooks/useProgramData";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { CatalogIndexRecord } from "@/lib/schemas";
import { isConfirm, isOpen } from "./pageModel";
import type { FillTarget } from "./suggestions";

/**
 * useFillTargets (spec 028 D10) — what a Try strip can fill: each open row of
 * a group, split per missing category on a distribution row. Every test is
 * the Classes page's "Counts toward" predicate (spec 022): a Distribution
 * row's own rule through buildLayerRowPredicate (narrowed to one missing
 * category), else the Engineering requirement predicate.
 *
 * Rows nothing can be suggested for are skipped: confirm rows, rows the app
 * can't check, waived / done rows, and credit totals ("120 credits" — every
 * class fills those).
 */
export function useFillTargets(
  programId: string | null,
  templateSlots: ProgramSlotWithData[]
): (items: readonly RequirementItem[]) => FillTarget[] {
  const { layers } = useProgramData(programId);
  const { aliases } = useCatalogContext();
  const canonical = useCallback((id: string) => aliases[id] ?? id, [aliases]);
  const engineering = useMemo(() => buildRequirementPredicate(templateSlots, canonical), [templateSlots, canonical]);
  const hasLayers = !!layers && layers.length > 0;

  return useCallback(
    (items) => {
      const targets: FillTarget[] = [];
      for (const it of items) {
        if (!isOpen(it) || isConfirm(it) || !it.checkable) continue;
        if (it.dist?.rowKind === "credits") continue;
        const missing = (it.dist?.categories ?? []).filter((c) => c.missing);
        if (hasLayers && it.dist) {
          if (missing.length > 0) {
            for (const c of missing) {
              const p = buildLayerRowPredicate(layers, () => [c.id], { programId, canonical }, aliases);
              targets.push({ label: c.label, test: (r: CatalogIndexRecord) => p(r, it.id) === true });
            }
          } else {
            const p = buildLayerRowPredicate(layers, () => undefined, { programId, canonical }, aliases);
            targets.push({ label: it.label, test: (r: CatalogIndexRecord) => p(r, it.id) === true });
          }
          continue;
        }
        targets.push({ label: it.label, test: (r: CatalogIndexRecord) => engineering(r, it.id) });
      }
      return targets;
    },
    [hasLayers, layers, programId, canonical, aliases, engineering]
  );
}
