/**
 * lib/credit/resolve.ts (spec 025 D3) — saved credit → ResolvedCredit[].
 *
 * CONTRACT (Phase 0 stub; lane 1B implements the body, signatures fixed):
 *   resolveCreditProfile(entries, college, tables)
 *     - exam entries (and LEGACY_EXAM_IDS entries) → courses, credits,
 *       courseCredits, limits, earnsNothing from the college's table
 *       (engineering → engineering table only; cas / cals → their override
 *       where it `replaces` the exam, else the university table, plus
 *       collegeLimits; null → university table);
 *       label = source.displayName ("AP Calculus BC (5)");
 *     - transfer entries → kept as saved, source { kind: "transfer" };
 *     - anything the tables can't place → kept as saved, "unresolved".
 *     Pure; same input → structurally equal output, in input order.
 *   examResult(exam, score, college, tables) → the award the editor shows on
 *     a row before saving (null = earns nothing in this college).
 *   scoresThatEarn(exam, tables) → the scores to show as buttons: those that
 *     earn something in ANY college, lowest first (D6).
 */
import type { CreditEntry } from "@/lib/schemas";
import type { CreditCollege, ExamAward, ExamTables, ResolvedCredit } from "./types";

export function resolveCreditProfile(
  entries: CreditEntry[],
  _college: CreditCollege,
  _tables: ExamTables | null
): ResolvedCredit[] {
  // STUB: pass-through until lane 1B lands.
  return entries.map((e) => ({ ...e, source: { kind: "unresolved" }, limits: [], earnsNothing: false }));
}

export function examResult(
  _exam: string,
  _score: string,
  _college: CreditCollege,
  _tables: ExamTables | null
): (ExamAward & { limits: string[] }) | null {
  return null; // STUB
}

export function scoresThatEarn(_exam: string, _tables: ExamTables | null): string[] {
  return []; // STUB
}
