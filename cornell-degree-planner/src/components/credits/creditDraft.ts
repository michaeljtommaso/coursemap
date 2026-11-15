/**
 * creditDraft (spec 028 D3/D6) — the credits editor's working copy of the
 * student's saved credit, and the exact list it saves back.
 *
 * Reading the saved list (raw CreditEntry[], useAuth().creditProfile):
 *   - an exam entry ({ exam, score }) whose exam the tables know → picked;
 *   - a legacy id ("ap-calc-bc-5", LEGACY_EXAM_IDS) → its exam picked at that
 *     score (a proper exam entry of the same exam wins), written back as a
 *     proper exam entry on the next save;
 *   - kind "transfer" → a transfer row (kept verbatim unless removed);
 *   - anything else (unknown exam ids, other kinds, everything exam-shaped
 *     while the tables are missing) → kept untouched.
 * Saving replaces the whole profile with draftToEntries(): picked exams, then
 * transfers, then the untouched entries.
 */
import type { CreditEntry } from "@/lib/schemas";
import { examResult } from "@/lib/credit/resolve";
import {
  CURRENT_TABLE_YEAR,
  LEGACY_EXAM_IDS,
  MAX_CREDIT_ENTRIES,
  examEntryId,
  type CreditCollege,
  type ExamDef,
  type ExamTables,
} from "@/lib/credit/types";
import { examDisplayName } from "./examDisplay";

export type CreditDraft = {
  /** exam id → picked score. Insertion order is the saved order. */
  picks: Record<string, string>;
  /** The proper exam entries as saved, by exam id: re-saved verbatim (same
   *  tableYear) when the pick is unchanged. */
  saved: Record<string, CreditEntry>;
  transfers: CreditEntry[];
  /** Entries the editor doesn't understand: saved back untouched. */
  kept: CreditEntry[];
};

export const EMPTY_DRAFT: CreditDraft = { picks: {}, saved: {}, transfers: [], kept: [] };

export function draftFromProfile(raw: CreditEntry[], tables: ExamTables | null): CreditDraft {
  const known = new Set((tables?.exams ?? []).map((e) => e.id));
  const picks: Record<string, string> = {};
  const saved: Record<string, CreditEntry> = {};
  const transfers: CreditEntry[] = [];
  const kept: CreditEntry[] = [];

  // Proper exam entries first, so one beats a legacy entry of the same exam.
  const legacy: CreditEntry[] = [];
  for (const entry of raw) {
    if (entry.exam && entry.score && known.has(entry.exam)) {
      if (!(entry.exam in picks)) {
        picks[entry.exam] = entry.score;
        saved[entry.exam] = entry;
      }
    } else if (LEGACY_EXAM_IDS[entry.id] && !entry.exam && known.has(LEGACY_EXAM_IDS[entry.id].exam)) {
      legacy.push(entry);
    } else if (entry.kind === "transfer") {
      transfers.push(entry);
    } else {
      kept.push(entry);
    }
  }
  for (const entry of legacy) {
    const { exam, score } = LEGACY_EXAM_IDS[entry.id];
    if (!(exam in picks)) picks[exam] = score;
  }
  return { picks, saved, transfers, kept };
}

/** How many entries the draft would save (the 60-entry cap counts these). */
export function draftSize(d: CreditDraft): number {
  return Object.keys(d.picks).length + d.transfers.length + d.kept.length;
}

/** The draft's credit before Cornell (spec 045 D4's running total): what each
 *  picked exam earns in this college (placement-only awards earn none), plus
 *  each transfer course's credits. Entries the editor keeps untouched aren't
 *  counted: it can't say what they earn. */
export function draftCredits(d: CreditDraft, college: CreditCollege, tables: ExamTables | null): number {
  let total = 0;
  for (const [exam, score] of Object.entries(d.picks)) {
    const award = examResult(exam, score, college, tables);
    if (award && !award.placementOnly) total += award.credits;
  }
  for (const t of d.transfers) total += t.credits ?? 0;
  return total;
}

export function atCap(d: CreditDraft): boolean {
  return draftSize(d) >= MAX_CREDIT_ENTRIES;
}

/** One click on a score button (D6): pick, clear (same score) or switch.
 *  A new pick at the cap is refused (returns the same draft). */
export function toggleScore(d: CreditDraft, exam: string, score: string): CreditDraft {
  const picks = { ...d.picks };
  if (picks[exam] === score) delete picks[exam];
  else if (exam in picks) picks[exam] = score;
  else if (atCap(d)) return d;
  else picks[exam] = score;
  return { ...d, picks };
}

export function addTransfer(d: CreditDraft, entry: CreditEntry): CreditDraft {
  if (atCap(d)) return d;
  return { ...d, transfers: [...d.transfers, entry] };
}

export function removeTransfer(d: CreditDraft, id: string): CreditDraft {
  return { ...d, transfers: d.transfers.filter((t) => t.id !== id) };
}

export function examEntry(def: ExamDef, score: string): CreditEntry {
  return {
    id: examEntryId(def.id),
    kind: def.family,
    label: examDisplayName(def).slice(0, 80),
    satisfiesCourseIds: [],
    exam: def.id,
    score,
    tableYear: CURRENT_TABLE_YEAR,
  };
}

/** The whole list to save (setCreditProfile replaces the profile). */
export function draftToEntries(d: CreditDraft, tables: ExamTables | null): CreditEntry[] {
  const defs = new Map((tables?.exams ?? []).map((e) => [e.id, e]));
  const exams: CreditEntry[] = [];
  for (const [exam, score] of Object.entries(d.picks)) {
    const prior = d.saved[exam];
    if (prior && prior.score === score) {
      exams.push(prior);
      continue;
    }
    const def = defs.get(exam);
    if (def) exams.push(examEntry(def, score));
  }
  return [...exams, ...d.transfers, ...d.kept];
}

/** Would saving change anything? Order-sensitive: a reordered list (or a
 *  legacy entry rewritten as an exam entry) counts as a change, which only
 *  costs a harmless extra write. */
export function draftChanged(d: CreditDraft, raw: CreditEntry[], tables: ExamTables | null): boolean {
  return JSON.stringify(draftToEntries(d, tables)) !== JSON.stringify(raw);
}

/** "transfer:<8 random>" not already used. */
export function newTransferId(taken: Iterable<string>): string {
  const used = new Set(taken);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let s = "";
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    for (let i = 0; i < 8; i++) {
      const n = bytes[i] || Math.floor(Math.random() * 256);
      s += alphabet[n % alphabet.length];
    }
    const id = `transfer:${s}`;
    if (!used.has(id)) return id;
  }
}
