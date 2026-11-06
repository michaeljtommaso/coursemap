/**
 * useCreditProfile (spec 028 D3) — the student's credit, resolved for their
 * current college. EVERY reader of credit uses this instead of
 * useAuth().creditProfile (which stays the raw saved list, for the editor).
 *
 *   resolved — ResolvedCredit[] (memoized: same identity while inputs are
 *              unchanged, so downstream useMemo caches hold)
 *   raw      — the saved CreditEntry[] (useAuth().creditProfile)
 *   college  — the college whose table applied (program family when a program
 *              is chosen, else studentContext.college, else null)
 *
 * The program is found exactly as useRequirementProgress finds it: the LOADED
 * plan's program, else the store's selection. The blank canvas ("Start from
 * scratch") is not a college, so it falls through to the student's first-run
 * college. While the program index is still loading the student's college
 * applies; the result re-resolves once the program is known.
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { EXAM_TABLES } from "@/data/credit-tables";
import { programFamily } from "@/lib/planner/colleges";
import { BLANK_PROGRAM_ID } from "@/lib/planner/rankMajors";
import type { CreditEntry } from "@/lib/schemas";
import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import { resolveCreditProfile } from "@/lib/credit/resolve";

export type CreditProfileView = {
  resolved: ResolvedCredit[];
  raw: CreditEntry[];
  college: CreditCollege;
};

// One shared result for every caller (each course card calls this hook): a
// module-level single-entry cache, so all instances get the SAME array while
// the saved list and the college are unchanged, and identity-keyed caches
// downstream (useRequirementProgress's) keep hitting.
let lastEntries: CreditEntry[] | null = null;
let lastCollege: CreditCollege = null;
let lastResolved: ResolvedCredit[] = [];

function sharedResolve(entries: CreditEntry[], college: CreditCollege): ResolvedCredit[] {
  if (entries === lastEntries && college === lastCollege) return lastResolved;
  lastResolved = resolveCreditProfile(entries, college, EXAM_TABLES);
  lastEntries = entries;
  lastCollege = college;
  return lastResolved;
}

export function useCreditProfile(): CreditProfileView {
  const { creditProfile, studentContext } = useAuth();
  const { planProgramId } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs } = usePrograms();

  const programId = planProgramId ?? selectedProgramId;
  const program = programId && programId !== BLANK_PROGRAM_ID ? programs.find((p) => p.id === programId) : undefined;
  // A primitive, so the memo below holds while the college is unchanged.
  const college: CreditCollege = program ? programFamily(program) : (studentContext.college ?? null);

  const resolved = useMemo(() => sharedResolve(creditProfile, college), [creditProfile, college]);
  return useMemo(() => ({ resolved, raw: creditProfile, college }), [resolved, creditProfile, college]);
}
