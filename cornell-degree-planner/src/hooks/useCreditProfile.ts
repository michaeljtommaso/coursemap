/**
 * useCreditProfile (spec 025 D3) — the student's credit, resolved for their
 * current college. EVERY reader of credit uses this instead of
 * useAuth().creditProfile (which stays the raw saved list, for the editor).
 *
 * CONTRACT (Phase 0 stub; lane 1B implements, the return shape is fixed):
 *   resolved — ResolvedCredit[] (memoized: same identity while inputs are
 *              unchanged, so downstream useMemo caches hold)
 *   raw      — the saved CreditEntry[] (useAuth().creditProfile)
 *   college  — the college whose table applied (program family when a program
 *              is chosen, else studentContext.college, else null)
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import type { CreditEntry } from "@/lib/schemas";
import type { CreditCollege, ResolvedCredit } from "@/lib/credit/types";
import { resolveCreditProfile } from "@/lib/credit/resolve";

export type CreditProfileView = {
  resolved: ResolvedCredit[];
  raw: CreditEntry[];
  college: CreditCollege;
};

export function useCreditProfile(): CreditProfileView {
  const { creditProfile } = useAuth();
  // STUB: lane 1B wires the college and the tables.
  const resolved = useMemo(() => resolveCreditProfile(creditProfile, null, null), [creditProfile]);
  return { resolved, raw: creditProfile, college: null };
}
