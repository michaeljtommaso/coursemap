/**
 * firstRunDraft — the first-run flow's progress, kept in this browser so a
 * reload or a closed tab resumes where the student was instead of restarting.
 *
 * Only a draft: nothing here creates a plan or touches the profile. The plan is
 * still created once, when first run finishes (the program is selected), which
 * is also when the draft is cleared. Stored per user id in localStorage, so no
 * server data shape or security rule is involved. Every storage access is
 * guarded; a blocked or full store just means no resume.
 */
import type { CreditDraft } from "@/components/credits/creditDraft";
import type { CreditEntry } from "@/lib/schemas";

export type FirstRunDoor = "known" | "discover";
export type FirstRunStep = "college" | "questions" | "credits";

export type FirstRunDraft = {
  door: FirstRunDoor | null;
  /** The program the student is working toward (the blank canvas included);
   *  null while still choosing one. */
  programId: string | null;
  step: FirstRunStep;
  /** The credit step's working copy, kept only once that step was reached. */
  creditDraft: CreditDraft | null;
};

const KEY_PREFIX = "cornell-first-run:";
const VERSION = 1;

const keyFor = (uid: string) => `${KEY_PREFIX}${uid}`;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isEntryList = (v: unknown): v is CreditEntry[] =>
  Array.isArray(v) && v.every((e) => isRecord(e) && typeof e.id === "string");

/** Accept a stored credit draft only when it has the exact shape the editor
 *  expects; anything else is dropped (the step then starts from the profile). */
function parseCreditDraft(v: unknown): CreditDraft | null {
  if (!isRecord(v)) return null;
  const { picks, saved, transfers, kept } = v;
  if (!isRecord(picks) || !Object.values(picks).every((s) => typeof s === "string")) return null;
  if (!isRecord(saved) || !Object.values(saved).every((e) => isRecord(e) && typeof e.id === "string")) return null;
  if (!isEntryList(transfers) || !isEntryList(kept)) return null;
  return {
    picks: picks as Record<string, string>,
    saved: saved as Record<string, CreditEntry>,
    transfers,
    kept,
  };
}

/** Parse stored text into a draft, or null when it is missing, malformed, from
 *  another version, or describes nothing worth resuming. */
export function parseFirstRunDraft(raw: string | null): FirstRunDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== VERSION) return null;
  const door = data.door === "known" || data.door === "discover" ? data.door : null;
  const programId = typeof data.programId === "string" && data.programId ? data.programId : null;
  const step: FirstRunStep =
    data.step === "college" || data.step === "credits" ? data.step : "questions";
  if (!door && !programId) return null;
  return {
    door,
    programId,
    step,
    creditDraft: step === "credits" ? parseCreditDraft(data.creditDraft) : null,
  };
}

export function loadFirstRunDraft(uid: string | null | undefined): FirstRunDraft | null {
  if (!uid) return null;
  try {
    return parseFirstRunDraft(store()?.getItem(keyFor(uid)) ?? null);
  } catch {
    return null;
  }
}

export function saveFirstRunDraft(uid: string | null | undefined, draft: FirstRunDraft): void {
  if (!uid) return;
  try {
    store()?.setItem(keyFor(uid), JSON.stringify({ v: VERSION, ...draft }));
  } catch {
    // Storage blocked or full: the flow simply won't resume after a reload.
  }
}

export function clearFirstRunDraft(uid: string | null | undefined): void {
  if (!uid) return;
  try {
    store()?.removeItem(keyFor(uid));
  } catch {
    // Nothing to do.
  }
}
