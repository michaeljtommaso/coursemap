import type { StudentPrefs } from "@/services/profile";
import type { ClassStanding, TransferKind } from "./distribution/types";
import { enteringYearForEntryTerm } from "./entryTerm";

/**
 * studentQuestions.ts (spec 019 D10, Phase 2 deviation 7) — which first-run
 * question comes next, and what the answers save. The component
 * (StudentContextQuestions) only renders; every decision lives here. Pure.
 *
 * Rules:
 *  - With `need`, ask exactly that one question (the Requirements panel asks
 *    the one thing selectLayers is missing).
 *  - Without it, ask what is still unanswered, in order: start term, then —
 *    only for Arts & Sciences / CALS programs — transferred in?, then the
 *    standing a transfer arrived at. Engineering never asks about transfers.
 *  - A start term counts as unanswered while either half is missing: the
 *    engine reads `entryTerm`, the semester labels read `enteringYear`.
 *  - A major that offers concentrations asks last: which one(s), within the
 *    layer's {min, max}. An answer on file counts only for the same major and
 *    only while it still satisfies min..max.
 *  - Nothing is guessed: an answer exists only once the student picks it.
 */

export type StudentContextNeed = "entry-term" | "transfer" | "transfer-standing" | "concentration";

/** Answers picked in this run of the questions (not yet saved). */
export type QuestionDraft = {
  entryTerm?: string;
  transfer?: TransferKind;
  transferStanding?: ClassStanding;
  /** Concentration ids picked (may be empty when the major allows none). */
  concentration?: string[];
};

/** What a major offers: asked only when `options` is non-empty. */
export type ConcentrationAsk = {
  programId: string;
  min: number;
  max: number;
  options: { id: string; name: string }[];
};

export type QuestionState = {
  need?: StudentContextNeed;
  /** What the profile already holds. */
  known: StudentPrefs;
  enteringYear: number | null;
  /** Ask the transfer questions (Distribution-family programs only). */
  askTransfer: boolean;
  draft: QuestionDraft;
  /** The selected major's concentrations; absent or no options → not asked. */
  concentrations?: ConcentrationAsk;
};

function answered(q: StudentContextNeed, draft: QuestionDraft): boolean {
  if (q === "entry-term") return draft.entryTerm !== undefined;
  if (q === "transfer") return draft.transfer !== undefined;
  if (q === "concentration") return draft.concentration !== undefined;
  return draft.transferStanding !== undefined;
}

/** Does the profile already hold a usable choice for this major? */
export function concentrationAnswered(known: StudentPrefs, ask: ConcentrationAsk): boolean {
  const c = known.concentration;
  if (!c || c.programId !== ask.programId) return false;
  const ids = new Set(c.ids);
  const valid = ask.options.filter((o) => ids.has(o.id)).length;
  return valid >= ask.min && valid <= ask.max && valid === ids.size;
}

/** The next question to show, or null once everything asked is answered. */
export function nextQuestion(s: QuestionState): StudentContextNeed | null {
  const { need, known, draft } = s;
  if (need) return answered(need, draft) ? null : need;

  if (draft.entryTerm === undefined && (!known.entryTerm || s.enteringYear == null)) return "entry-term";
  if (s.askTransfer) {
    const transfer = draft.transfer ?? known.transfer;
    if (transfer == null) return "transfer";
    if (transfer !== "none" && draft.transferStanding === undefined && known.transferStanding == null) {
      return "transfer-standing";
    }
  }
  const ask = s.concentrations;
  if (ask && ask.options.length > 0 && draft.concentration === undefined && !concentrationAnswered(known, ask)) {
    return "concentration";
  }
  return null;
}

/** What to write once the asked questions are answered. "Not a transfer"
 *  clears any stale standing; a start term also re-derives enteringYear. */
export function answersToSave(draft: QuestionDraft, programId?: string | null): {
  prefs: Partial<StudentPrefs>;
  enteringYear: number | null;
} {
  const prefs: Partial<StudentPrefs> = {};
  if (draft.entryTerm !== undefined) prefs.entryTerm = draft.entryTerm;
  if (draft.transfer !== undefined) {
    prefs.transfer = draft.transfer;
    if (draft.transfer === "none") prefs.transferStanding = null;
  }
  if (draft.transferStanding !== undefined) prefs.transferStanding = draft.transferStanding;
  if (draft.concentration !== undefined && programId) {
    prefs.concentration = { programId, ids: draft.concentration };
  }
  return { prefs, enteringYear: enteringYearForEntryTerm(draft.entryTerm) };
}
