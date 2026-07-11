/**
 * statusLine.ts (spec 007 §1b, Unit 7C2) — the ONE precedence rule for the
 * single plain-language line SlotCard/CourseDetailPanel show under a course:
 *
 *   blocked message > offered warning > overlap > advisory > nothing.
 *
 * Pure + unit-tested (decision 7 — do not leave the precedence untested).
 * SlotCard/CourseDetailPanel each own their own JSX/className mapping per
 * `kind`; this module only decides WHICH line wins and what it says.
 */

const TERM_NAMES: Record<string, string> = {
  FA: "Fall",
  SP: "Spring",
  SU: "Summer",
  WI: "Winter",
};

/** "Needs CS 2110 first" — two leaves read as OR-alternatives (either fixes
 *  it); 3+ names two and trails off. */
export function blockedMessage(leaves: string[]): string {
  if (leaves.length === 0) return "Prerequisites not met";
  if (leaves.length === 1) return `Needs ${leaves[0]} first`;
  if (leaves.length === 2) return `Needs ${leaves[0]} or ${leaves[1]} first`;
  return `Needs ${leaves[0]}, ${leaves[1]} …`;
}

/** "Usually offered in Fall only" — names the course's actual offered terms. */
export function offeredMessage(offered: string[]): string {
  const names = offered.map((t) => TERM_NAMES[t] ?? t);
  if (names.length === 0) return "Check when this is offered";
  if (names.length === 1) return `Usually offered in ${names[0]} only`;
  const last = names[names.length - 1];
  return `Usually offered in ${names.slice(0, -1).join(", ")} or ${last}`;
}

/** "Credit is given for only one of this and CS 1112" — built from
 *  slotStatus.overlaps (the OTHER placed course's display code(s)). */
export function overlapMessage(overlaps: string[]): string {
  if (overlaps.length === 1) return `Credit is given for only one of this and ${overlaps[0]}`;
  return `Credit is given for only one of this and ${overlaps.join(", ")}`;
}

/** "Usually also satisfied by: equivalent AP credit" — the first advisory
 *  note, prefixed so a parser-authored fragment ("or equivalent AP credit")
 *  reads as prose rather than a dangling conjunction. */
export function advisoryMessage(note: string): string {
  const cleaned = note.replace(/^\s*(or|and)\s+/i, "");
  return `Usually also satisfied by: ${cleaned}`;
}

/** Whether a note is worth an "Add AP credit" deep-link (decision 1/3/5c) —
 *  case-insensitive AP/credit/equivalent mention. */
export function mentionsCredit(text: string): boolean {
  return /ap|credit|equivalent/i.test(text);
}

/**
 * Whether a BLOCKED card's unmet leaves could be fixed by a known credit
 * equivalency (spec 007 §2b — the falsely-blocked-on-AP freshman is the
 * target user; a blocked card that credit could unblock must offer the
 * "Add AP credit" action, not a dead end). Exact code matches only: each
 * entry's satisfiesCourseIds (dash form, "MATH-1910") converts to code form
 * ("MATH 1910") and is tested against the leaves verbatim, so pattern leaves
 * ("CS 111x") never match and are thereby ignored. Pure — entries arrive as
 * a param (call sites pass CREDIT_EQUIVALENCIES) so tests need no data import.
 */
export function creditCouldUnblock(
  unmetLeaves: string[],
  entries: { satisfiesCourseIds: string[] }[]
): boolean {
  if (unmetLeaves.length === 0) return false;
  const leaves = new Set(unmetLeaves);
  for (const entry of entries) {
    for (const id of entry.satisfiesCourseIds) {
      if (leaves.has(id.replace(/-/g, " "))) return true;
    }
  }
  return false;
}

export type CardStatusLine =
  | { kind: "blocked"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "overlap"; text: string }
  | { kind: "advisory"; text: string };

export type CardStatusLineInput = {
  blocked: boolean;
  unmetPrereqLeaves: string[];
  offeredOk: boolean | null;
  offered: string[];
  overlaps: string[];
  prereqState: "met" | "advisory" | "blocked" | null;
  advisoryNotes: string[];
};

/**
 * The card/panel's derived (non-manual) status line, in precedence order:
 * blocked > offered warning > overlap > advisory > nothing. Manual states
 * (completed/in-progress/waived) are NOT this function's concern — callers
 * gate on those first and only reach this for the remaining "available"-family
 * cards, per spec 007 §1b's CardVisual precedence.
 */
export function resolveCardStatusLine(input: CardStatusLineInput): CardStatusLine | null {
  if (input.blocked) {
    return { kind: "blocked", text: blockedMessage(input.unmetPrereqLeaves) };
  }
  if (input.offeredOk === false) {
    return { kind: "warning", text: offeredMessage(input.offered) };
  }
  if (input.overlaps.length > 0) {
    return { kind: "overlap", text: overlapMessage(input.overlaps) };
  }
  if (input.prereqState === "advisory" && input.advisoryNotes.length > 0) {
    return { kind: "advisory", text: advisoryMessage(input.advisoryNotes[0]) };
  }
  return null;
}
