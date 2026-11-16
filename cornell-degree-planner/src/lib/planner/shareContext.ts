import type { Layer, LayerFamily, MarkValue } from "./distribution/types";
import type { AdditionalProgram, ShareDoc } from "@/lib/schemas";
import { selectLayers } from "./distribution/select";
import { canonicalAdditionalPrograms, canonicalProgramId } from "./legacyPrograms";

/**
 * shareContext.ts (spec 020 D6) — what a share link carries for scoring, and
 * how the share view reads it back.
 *
 * A share copies the plan's course marks, the college rule set chosen for the
 * student (a college layer id, e.g. "cals-college-pre2025") and the chosen
 * concentration ids. It never copies the student's facts (`prefs.answers`) or
 * the raw entry term / transfer answers: share links are readable by anyone
 * holding them, and those answers are personal. The resolved rule set is all
 * the share view needs to score the right college version.
 *
 * The rule set can itself encode a personal answer: one college version may
 * apply both to students who entered before a date and to transfers who
 * entered later (cals-college-pre2025), so next to the share's enteringYear it
 * would reveal transfer status. shareCollegeRuleSet keeps the rule set only
 * when the entry term alone picks it.
 *
 * Spec 047 D13: a share also snapshots the plan's second major and minors
 * (`additionalPrograms`), so the share view scores and names every program.
 */

/** The scoring inputs a share carries (contract C). */
export type ShareProgressInput = {
  /** The college layer to force in selectLayers; absent on shares written
   *  before spec 020 (the share view then has no rule set to score with). */
  collegeLayerId?: string;
  concentrationIds: string[];
  courseMarks: Record<string, MarkValue>;
};

export function shareProgressInput(
  share: Pick<ShareDoc, "collegeRuleSet" | "concentrationIds" | "courseMarks">
): ShareProgressInput {
  return {
    ...(share.collegeRuleSet ? { collegeLayerId: share.collegeRuleSet } : {}),
    concentrationIds: share.concentrationIds ?? [],
    courseMarks: share.courseMarks ?? {},
  };
}

/**
 * The college rule set a share may record (spec 020 D6): `chosenId` when the
 * student's entry term alone selects that same college layer (the selection
 * made as if the student were not a transfer), otherwise undefined. A rule
 * set picked because of a transfer answer would let a link holder infer that
 * answer, so it is left off and the share reads like one written before spec
 * 020. A family with a single college layer always keeps it: the rule set
 * then says nothing about the student. Pure.
 */
export function shareCollegeRuleSet(
  chosenId: string | null | undefined,
  input: {
    layers: readonly Layer[] | null | undefined;
    family: LayerFamily;
    programId: string;
    entryTerm: string | null | undefined;
  }
): string | undefined {
  if (!chosenId || !input.layers) return undefined;
  const byEntryTerm = selectLayers([...input.layers], {
    family: input.family,
    programId: input.programId,
    entryTerm: input.entryTerm ?? null,
    transfer: "none",
    transferStanding: null,
  }).layers.find((l) => l.kind === "college")?.id;
  return byEntryTerm === chosenId ? chosenId : undefined;
}

/** Most concentrations a share records (rules: concentrationIds.size() <= 3). */
const MAX_SHARED_CONCENTRATIONS = 3;

/**
 * The spec 020 fields for a new share. Only fields with something to say are
 * included, so a plan with no marks, rule set or concentration writes the
 * same share shape as before. Deliberately takes no student facts or start
 * answers: there is no way to pass them in.
 */
export function shareAnswerFields(input: {
  courseMarks?: Record<string, MarkValue> | null;
  collegeLayerId?: string | null;
  concentrationIds?: readonly string[] | null;
  /** Spec 047 D13: the plan's extra programs, snapshotted (copied entry by
   *  entry) without `primaryProgramId` (the share's own program). */
  additionalPrograms?: readonly AdditionalProgram[] | null;
  primaryProgramId?: string | null;
}): Pick<ShareDoc, "courseMarks" | "collegeRuleSet" | "concentrationIds" | "additionalPrograms"> {
  const marks = input.courseMarks ?? {};
  const concentrationIds = [...new Set(input.concentrationIds ?? [])].slice(0, MAX_SHARED_CONCENTRATIONS);
  const programs = (input.additionalPrograms ?? [])
    .filter((p) => p.programId !== input.primaryProgramId)
    .map(
      (p): AdditionalProgram => ({
        programId: p.programId,
        kind: p.kind,
        ...(p.concentrationIds && p.concentrationIds.length > 0 ? { concentrationIds: [...p.concentrationIds] } : {}),
      })
    );
  return {
    ...(Object.keys(marks).length > 0 ? { courseMarks: { ...marks } } : {}),
    ...(input.collegeLayerId ? { collegeRuleSet: input.collegeLayerId } : {}),
    ...(concentrationIds.length > 0 ? { concentrationIds } : {}),
    ...(programs.length > 0 ? { additionalPrograms: programs } : {}),
  };
}

/**
 * A share's extra programs (spec 047 D13) as the share view reads them:
 * under their current ids (spec 019 D12), without a repeat or the share's
 * own program; [] for a share written before spec 047. Pure.
 */
export function shareAdditionalPrograms(
  share: Pick<ShareDoc, "programId" | "additionalPrograms">
): AdditionalProgram[] {
  return canonicalAdditionalPrograms(share.additionalPrograms ?? [], canonicalProgramId(share.programId));
}
