import { useCallback, useMemo } from "react";
import type { ProgramSlotWithData } from "@/types/db";
import type { RequirementItem } from "@/hooks/useRequirementProgress";
import {
  buildLayerRowPredicate,
  buildLiberalStudiesPredicate,
  buildRequirementPredicate,
  useLiberalStudiesFilterCohort,
} from "@/hooks/useCourseFilters";
import { LIBERAL_STUDIES_GROUP_ID } from "@/lib/planner/liberalStudies";
import { liberalStudiesOptionId } from "@/lib/classes/requirementFilter";
import { useProgramData } from "@/hooks/useProgramData";
import { useAdditionalProgramData } from "@/hooks/useAdditionalProgramData";
import { secondMajorSlots } from "@/lib/planner/engineeringDoubleMajor";
import type { AdditionalProgram } from "@/lib/schemas";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Layer } from "@/lib/planner/distribution/types";
import { isConfirm, isOpen } from "./pageModel";
import type { FillTarget } from "./suggestions";

/** What buildFillTargets reads: the Classes page's "Counts toward" predicates
 *  for this program and student. */
export type FillTargetContext = {
  layers: readonly Layer[] | undefined;
  programId: string | null;
  canonical: (id: string) => string;
  aliases: Record<string, string>;
  /** The Engineering requirement predicate (buildRequirementPredicate). */
  engineering: (r: CatalogIndexRecord, requirementId: string) => boolean;
  /** The liberal studies predicate for the student's entering class
   *  (buildLiberalStudiesPredicate). */
  liberalStudies: (r: CatalogIndexRecord, requirementId: string) => boolean | null;
};

/**
 * What a Try strip can fill (spec 028 D10): each open row of a group, split
 * per missing category on a distribution row. Every test is the Classes
 * page's "Counts toward" predicate (spec 022): a Distribution row's own rule
 * through buildLayerRowPredicate (narrowed to one missing category), the
 * liberal studies predicate for Engineering's liberal studies row (spec 037
 * D10), else the Engineering requirement predicate. Pure.
 *
 * Rows nothing can be suggested for are skipped: confirm rows, rows the app
 * can't check, waived / done rows, and credit totals ("120 credits" — every
 * class fills those).
 */
export function buildFillTargets(items: readonly RequirementItem[], ctx: FillTargetContext): FillTarget[] {
  const { layers, programId, canonical, aliases, engineering, liberalStudies } = ctx;
  const hasLayers = !!layers && layers.length > 0;
  const targets: FillTarget[] = [];
  for (const it of items) {
    if (!isOpen(it) || isConfirm(it) || !it.checkable) continue;
    if (it.dist?.rowKind === "credits") continue;
    const missing = (it.dist?.categories ?? []).filter((c) => c.missing);
    // Spec 037 D9: Engineering liberal studies splits by missing group, as a
    // distribution row does by missing category. Checked before the layer
    // rows: its `dist` is shaped like one, but it is no layer's row.
    if (it.id === LIBERAL_STUDIES_GROUP_ID) {
      if (it.dist && missing.length > 0) {
        for (const c of missing) {
          const id = liberalStudiesOptionId(c.id);
          targets.push({ label: c.label, test: (r: CatalogIndexRecord) => liberalStudies(r, id) === true });
        }
      } else {
        targets.push({ label: it.label, test: (r: CatalogIndexRecord) => liberalStudies(r, it.id) === true });
      }
      continue;
    }
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
}

const NO_EXTRAS: AdditionalProgram[] = [];

/** useFillTargets (spec 028 D10) — buildFillTargets over every program on the
 *  plan and the student's liberal studies entering class.
 *
 *  Spec 047: a second major's and minors' rows are read with their own rules:
 *  their layers join the primary's (a layer row id names its layer), and an
 *  Engineering second major's rows (which share ids with no prefix) go
 *  through its own template, filtered as the engine filters it, when the
 *  caller passes that program's section id. A row no program knows suggests
 *  nothing (it used to suggest every class). */
export function useFillTargets(
  programId: string | null,
  templateSlots: ProgramSlotWithData[],
  additionalPrograms: AdditionalProgram[] = NO_EXTRAS
): (items: readonly RequirementItem[], sectionId?: string | null) => FillTarget[] {
  const { layers: ownLayers } = useProgramData(programId);
  const { programs: extras } = useAdditionalProgramData(additionalPrograms);
  const { aliases } = useCatalogContext();
  const canonical = useCallback((id: string) => aliases[id] ?? id, [aliases]);
  const layers = useMemo(() => {
    const extra = extras.flatMap((p) => (p.status === "ok" ? p.layers : []));
    return extra.length > 0 ? [...(ownLayers ?? []), ...extra] : ownLayers;
  }, [ownLayers, extras]);
  const engineering = useMemo(
    () => buildRequirementPredicate(templateSlots, canonical, false),
    [templateSlots, canonical]
  );
  // D15: the Engineering second major's own rows, as the engine sees them.
  const second = extras.find((p) => p.kind === "major" && p.status === "ok" && (p.template?.length ?? 0) > 0);
  const secondId = second?.programId ?? null;
  const secondTemplate = second?.template;
  const secondEngineering = useMemo(
    () =>
      secondTemplate
        ? buildRequirementPredicate(secondMajorSlots(templateSlots, secondTemplate, canonical), canonical, false)
        : null,
    [templateSlots, secondTemplate, canonical]
  );
  const lsCohort = useLiberalStudiesFilterCohort();
  const liberalStudies = useMemo(() => buildLiberalStudiesPredicate(lsCohort), [lsCohort]);

  return useCallback(
    (items, sectionId) =>
      buildFillTargets(items, {
        layers,
        programId,
        canonical,
        aliases,
        engineering: secondEngineering && sectionId && sectionId === secondId ? secondEngineering : engineering,
        liberalStudies,
      }),
    [layers, programId, canonical, aliases, engineering, secondEngineering, secondId, liberalStudies]
  );
}
