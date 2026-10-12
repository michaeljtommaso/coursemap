import { describeLeaf, joinAlternatives, isPatternLeaf, type LeafDescriber } from "./leafWording";
import type { PendingChoice } from "./pendingChoices";

/**
 * statusLine.ts (spec 007 §1b, Unit 7C2) — the ONE precedence rule for the
 * single plain-language line CourseCard/CourseDetailPanel show under a course:
 *
 *   covered by credit > blocked message > pick-one choice > offered warning
 *   > overlap > conflict > advisory > nothing.
 *
 * "Pick-one choice" is a blocked course whose missing prerequisite is an open
 * choice requirement the student hasn't picked yet (pendingChoices.ts): amber,
 * not red, and it points at the choice ("Pick your Intro Programming first").
 * It only ever replaces the blocked line; a blocked course with no pending
 * choice keeps the red blocked message.
 *
 * Leaves are worded through leafWording (a raw pattern like "CS 111x" never
 * reaches a student), and corequisite misses read "Take X alongside", never
 * "Needs X first". When both trees fail, the prerequisite message leads and
 * the corequisite message is carried as `secondary`.
 *
 * "Covered by credit" (spec 007 §2c) leads: when the student's credit profile
 * already grants the placed course (AP Calculus BC → MATH 1910), every other
 * check on it is moot — the engine reports it never-blocked, and the line says
 * why ("Covered by your AP credit") instead of going silent.
 *
 * The "conflict" kind (spec 012 §4) is the near-horizon time collision — amber,
 * advisory, NEVER blocking; it slots after overlap (a credit-exclusion, a
 * stronger claim) and before advisory (the softest note).
 *
 * Pure + unit-tested (decision 7 — do not leave the precedence untested).
 * CourseCard/CourseDetailPanel each own their own JSX/className mapping per
 * `kind`; this module only decides WHICH line wins and what it says.
 */

const TERM_NAMES: Record<string, string> = {
  FA: "Fall",
  SP: "Spring",
  SU: "Summer",
  WI: "Winter",
};

/** "CS 2110", "CS 2110 or CS 2800", "CS 2110, CS 2800 …" — two leaves read
 *  as OR-alternatives (either fixes it); 3+ names two and trails off. */
function leafPhrase(leaves: string[], describe: LeafDescriber): string {
  const words = leaves.map(describe);
  if (words.length <= 2) return words.join(" or ");
  return `${words[0]}, ${words[1]} …`;
}

/** "Needs CS 2110 first" — two leaves read as OR-alternatives (either fixes
 *  it); 3+ names two and trails off. Pattern leaves are worded by `describe`
 *  (default: plain language, e.g. "an intro CS course (CS 111x)"). */
export function blockedMessage(leaves: string[], describe: LeafDescriber = describeLeaf): string {
  if (leaves.length === 0) return "Prerequisites not met";
  const phrase = leafPhrase(leaves, describe);
  return leaves.length <= 2 ? `Needs ${phrase} first` : `Needs ${phrase}`;
}

/** "Take CHEM 2091 alongside" — a corequisite miss: taken in the same
 *  semester (or earlier), not before. Same leaf rules as blockedMessage. */
export function coreqMessage(leaves: string[], describe: LeafDescriber = describeLeaf): string {
  if (leaves.length === 0) return "Corequisites not met";
  return `Take ${leafPhrase(leaves, describe)} alongside`;
}

/** Requirement labels too generic (or too code-like) to name a choice by:
 *  empty, the matcher's "Requirement" fallback, or a bare code/pattern. */
function isGenericLabel(label: string): boolean {
  const l = label.trim();
  if (!l || /^requirement$/i.test(l)) return true;
  return /^[A-Z&]{2,8}[\s-]?[\dxX*]{4}$/i.test(l);
}

/** "Pick your Intro Programming (CS 1110/1112) first" — a course waiting on an
 *  open choice requirement. A generic or code-like label names the leaves
 *  instead ("Pick CS 1110 or CS 1112 first"); a bare pattern never shows. */
export function choiceMessage(
  choice: Pick<PendingChoice, "label" | "leaves">,
  describe: LeafDescriber = describeLeaf
): string {
  if (!isGenericLabel(choice.label)) return `Pick your ${choice.label.trim()} first`;
  const fromLabel = isPatternLeaf(choice.label) ? [choice.label] : [];
  const leaves = choice.leaves.length > 0 ? choice.leaves : fromLabel;
  if (leaves.length === 0) return "Pick a course for this requirement first";
  return `Pick ${joinAlternatives(leaves.map(describe))} first`;
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
 *  cardStatus.overlaps (the OTHER placed course's display code(s)). */
export function overlapMessage(overlaps: string[]): string {
  if (overlaps.length === 1) return `Credit is given for only one of this and ${overlaps[0]}`;
  return `Credit is given for only one of this and ${overlaps.join(", ")}`;
}

/** "Meets at the same time as CS 2110" — the near-horizon time-conflict
 *  advisory (spec 012 §4). Amber, never blocking; the detail panel adds the
 *  honest caption "based on the main lecture times — other sections may differ". */
export function conflictMessage(otherCode: string): string {
  return `Meets at the same time as ${otherCode}`;
}

const CREDIT_KIND_NAMES: Record<string, string> = {
  ap: "AP",
  ib: "IB",
  transfer: "transfer",
  placement: "placement",
};

/** "Covered by your AP credit" — the placed course is already granted by a
 *  credit-profile entry of this kind (cardStatus.coveredByCredit.kind). An
 *  unknown kind reads as plain "credit". */
export function creditMessage(kind: string): string {
  const name = CREDIT_KIND_NAMES[kind];
  return name ? `Covered by your ${name} credit` : "Covered by your credit";
}

/** Longest parser note quoted verbatim; anything longer reads generically so
 *  the card's line stays within two lines. */
const MAX_ESCAPE_NOTE = 36;

/** The escape hatch an advisory node's note describes, as a clause: "an
 *  equivalent or AP credit also counts", "permission of instructor also
 *  counts". The parser's note is a stripped fragment ("or equivalent",
 *  sometimes just "equivalent"), so a bare "equivalent(s)" is spelled out
 *  and a leading conjunction or trailing punctuation is dropped. */
export function advisoryEscape(note: string): string {
  let cleaned = note
    .trim()
    .replace(/^(or|and)\s+/i, "")
    .replace(/[.,;:\s]+$/, "");
  if (!cleaned || /^(an?\s+)?equivalents?$/i.test(cleaned)) {
    return "an equivalent or AP credit also counts";
  }
  if (cleaned.length > MAX_ESCAPE_NOTE) return "alternatives also count";
  // Mid-sentence after the dash: lower-case a capitalised word ("Permission"),
  // never an acronym or code ("AP Chem", "CS 1110").
  if (/^[A-Z][a-z]/.test(cleaned)) cleaned = cleaned[0].toLowerCase() + cleaned.slice(1);
  // A note already phrased as a clause ("AP credit also counts") stands as is.
  return /\balso counts?$/i.test(cleaned) ? cleaned : `${cleaned} also counts`;
}

/** The soft-prerequisite line: "Usually needs MATH 1910 first — an equivalent
 *  or AP credit also counts". Names the unmet course(s) inside the advisory
 *  node (same leaf rules as blockedMessage) and the escape hatch its note
 *  describes. Without leaves (a caller that doesn't supply them) it still
 *  says the requirement is soft rather than echoing the bare note. */
export function advisoryMessage(
  note: string,
  leaves: string[] = [],
  describe: LeafDescriber = describeLeaf
): string {
  const escape = advisoryEscape(note);
  if (leaves.length === 0) return `Prerequisite is flexible — ${escape}`;
  const phrase = leafPhrase(leaves, describe);
  return leaves.length <= 2
    ? `Usually needs ${phrase} first — ${escape}`
    : `Usually needs ${phrase} — ${escape}`;
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
  | { kind: "credit"; text: string }
  /** `secondary`: the corequisite message when BOTH trees fail (the
   *  prerequisite message leads). Absent otherwise. */
  | { kind: "blocked"; text: string; secondary?: string }
  /** Waiting on an open choice requirement; the line opens the catalog
   *  scoped to it (requirementId / requirementLabel). */
  | { kind: "choice"; text: string; requirementId: string; requirementLabel: string }
  | { kind: "warning"; text: string }
  | { kind: "overlap"; text: string }
  | { kind: "conflict"; text: string }
  | { kind: "advisory"; text: string };

export type CardStatusLineInput = {
  blocked: boolean;
  /** Unmet HARD leaves of the prerequisite tree. */
  unmetPrereqLeaves: string[];
  /** Unmet HARD leaves of the corequisite tree (cardStatus.unmetCoreqLeaves).
   *  Optional so older callers still compile; absent → treated as none. */
  unmetCoreqLeaves?: string[];
  /** The open choice this blocked course is waiting on (pendingChoices.ts), or
   *  null/absent. Only consulted when `blocked`. */
  pendingChoice?: PendingChoice | null;
  /** Leaf wording (leafWording.makeLeafDescriber over the catalog). Absent →
   *  the catalog-free plain-language describer. */
  describeLeaf?: LeafDescriber;
  offeredOk: boolean | null;
  offered: string[];
  overlaps: string[];
  /** Near-horizon time conflict (spec 012 §4) — the display code of another
   *  near-column course this one meets at the same time as, or null. */
  conflictWith: string | null;
  prereqState: "met" | "advisory" | "blocked" | null;
  advisoryNotes: string[];
  /** cardStatus.advisoryLeaves — the unmet courses inside the prereq tree's
   *  advisory nodes, named by the advisory line. Optional; absent → the
   *  line still reads, just without naming them. */
  advisoryLeaves?: string[];
  /** cardStatus.coveredByCredit — the credit entry already granting this
   *  course, or null. Optional so a caller that predates it still compiles
   *  (it simply never shows the credit line). */
  coveredByCredit?: { kind: string; label: string } | null;
};

/** The blocked line: the prerequisite message leads; a corequisite-only miss
 *  reads "Take X alongside"; when both fail the coreq message is secondary. */
export function blockedLine(
  prereqLeaves: string[],
  coreqLeaves: string[],
  describe: LeafDescriber = describeLeaf
): { kind: "blocked"; text: string; secondary?: string } {
  if (prereqLeaves.length > 0) {
    return coreqLeaves.length > 0
      ? {
          kind: "blocked",
          text: blockedMessage(prereqLeaves, describe),
          secondary: coreqMessage(coreqLeaves, describe),
        }
      : { kind: "blocked", text: blockedMessage(prereqLeaves, describe) };
  }
  if (coreqLeaves.length > 0) return { kind: "blocked", text: coreqMessage(coreqLeaves, describe) };
  return { kind: "blocked", text: blockedMessage([], describe) };
}

/**
 * The card/panel's derived (non-manual) status line, in precedence order:
 * credit > blocked > choice > offered warning > overlap > conflict > advisory
 * > nothing (a pending choice turns the blocked line into the choice line). Manual states
 * (completed/in-progress/waived) are NOT this function's concern — callers
 * gate on those first and only reach this for the remaining "available"-family
 * cards, per spec 007 §1b's CardVisual precedence.
 */
export function resolveCardStatusLine(input: CardStatusLineInput): CardStatusLine | null {
  if (input.coveredByCredit) {
    return { kind: "credit", text: creditMessage(input.coveredByCredit.kind) };
  }
  const describe = input.describeLeaf ?? describeLeaf;
  if (input.blocked) {
    const choice = input.pendingChoice;
    if (choice) {
      return {
        kind: "choice",
        text: choiceMessage(choice, describe),
        requirementId: choice.requirementId,
        requirementLabel: choice.label,
      };
    }
    return blockedLine(input.unmetPrereqLeaves, input.unmetCoreqLeaves ?? [], describe);
  }
  if (input.offeredOk === false) {
    return { kind: "warning", text: offeredMessage(input.offered) };
  }
  if (input.overlaps.length > 0) {
    return { kind: "overlap", text: overlapMessage(input.overlaps) };
  }
  if (input.conflictWith) {
    return { kind: "conflict", text: conflictMessage(input.conflictWith) };
  }
  if (input.prereqState === "advisory" && input.advisoryNotes.length > 0) {
    return {
      kind: "advisory",
      text: advisoryMessage(input.advisoryNotes[0], input.advisoryLeaves ?? [], describe),
    };
  }
  return null;
}
