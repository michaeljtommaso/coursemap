import {
  ADDITIONAL_PROGRAMS,
  MAX_FACT_ANSWERS,
  type AdditionalProgram,
  type CreditEntry,
} from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { CollegeId } from "@/lib/planner/colleges";
import type {
  ClassStanding,
  FactValue,
  MarkValue,
  TransferKind,
} from "@/lib/planner/distribution/types";
import { enteringYearForEntryTerm } from "@/lib/planner/entryTerm";
import {
  canonicalAdditionalPrograms,
  canonicalProgramId,
  migrateLegacyWaivers,
} from "@/lib/planner/legacyPrograms";

/**
 * Guest carry-over decisions (spec 018), pure. When a guest signs into a Google
 * account that already exists, their edited plans are copied into it and their
 * profile fills the account's gaps. The services layer reads and writes; this
 * module only decides what to copy and what to call it.
 */

/** Client mirror of the firestore.rules favorites cap (favoriteCourseIds ≤ 200). */
export const MAX_FAVORITES = 200;
/** Compare-tray product cap (spec 013 §2): up to 4 pins side by side. */
export const MAX_PINS = 4;
/** rules: plan name.size() <= 80 — keep in sync with firestore.rules */
const MAX_PLAN_NAME = 80;

/** A plan's content, in the shape createPlan takes. */
export type CarryPlanContent = {
  name: string;
  programId: string;
  placements: Placement[];
  courseSnapshots: Record<string, unknown>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  /** Spec 020 course marks; travel with the plan copy. Optional: a retry
   *  stashed before spec 020 has none. */
  courseMarks?: Record<string, MarkValue>;
  /** Spec 028 D12 tried classes (course ids); travel with the plan copy and
   *  through a retired program id unchanged (they name courses, not
   *  requirements). Optional: a retry stashed before spec 028 has none. */
  triedCourseIds?: string[];
  /** Spec 042 D4 added short-term columns (the k of "the short term before
   *  semester k"); travel with the plan copy, like the placements' own
   *  `shortTerm` flags. Optional: a retry stashed before spec 042 has none. */
  shortTerms?: number[];
  /** Spec 047 D13 second major and minors; travel with the plan copy, under
   *  their current ids. Optional: a retry stashed before spec 047 has none. */
  additionalPrograms?: AdditionalProgram[];
};

/** A guest plan as read for carrying over. */
export type CarryPlan = {
  id: string;
  /** Server times in ms, or null when the doc has none. */
  createdAtMs: number | null;
  updatedAtMs: number | null;
  /** A retired slot-shape doc (schemaVersion < 3): read as empty, never copied. */
  legacy: boolean;
  content: CarryPlanContent;
};

/** Spec 019 D10/D11 start-at-Cornell answers and college, as stored in
 *  `prefs` (null = not answered). Mirrors services/profile StudentPrefs. */
export type CarryStudentPrefs = {
  entryTerm: string | null;
  transfer: TransferKind | null;
  transferStanding: ClassStanding | null;
  college: CollegeId | null;
  concentration: { programId: string; ids: string[] } | null;
  /** Spec 020 student facts (answer key → "yes" / "no"). Optional: a retry
   *  stashed before spec 020 has none. */
  answers?: Record<string, FactValue>;
};

/** The profile fields carry-over reads (guest) or fills (account). */
export type CarryProfile = {
  activePlanId: string | null;
  favoriteCourseIds: string[];
  pinnedCourseIds: string[];
  creditProfile: CreditEntry[];
  enteringYear: number | null;
  /** Optional: a retry saved before spec 019 has none. */
  studentPrefs?: Partial<CarryStudentPrefs>;
};

export type CarryCopy = { fromId: string; newId: string; input: CarryPlanContent };

export type ProfileCarryPatch = Partial<{
  favoriteCourseIds: string[];
  pinnedCourseIds: string[];
  creditProfile: CreditEntry[];
  enteringYear: number;
}>;

/**
 * A plan's content under its current program (spec 019 D12): a retired
 * program id reads as its current id, with its waivers translated, so a copy
 * is written under the new id. Its additional programs (spec 047 D13) are
 * read tolerantly (a retry stash comes back from browser storage unchecked)
 * and under their current ids, without a repeat or the primary, so the
 * strict write can't refuse the copy forever. Anything else is returned as
 * is (same object when nothing changes).
 */
export function currentProgramContent(content: CarryPlanContent): CarryPlanContent {
  // Defensive: a retry stash is read back from browser storage unchecked.
  const stored: unknown = content?.programId;
  if (typeof stored !== "string") return content;
  const programId = canonicalProgramId(stored);
  const programs = carriedPrograms(content.additionalPrograms, programId);
  if (programId === stored && programs === content.additionalPrograms) return content;
  const out: CarryPlanContent = { ...content, programId };
  if (programId !== stored) {
    out.waivedRequirementIds = Array.isArray(content.waivedRequirementIds)
      ? migrateLegacyWaivers(stored, content.waivedRequirementIds)
      : content.waivedRequirementIds;
  }
  if (programs === undefined) delete out.additionalPrograms;
  else out.additionalPrograms = programs;
  return out;
}

/** A copy's additional programs, safe to write under `programId`: the same
 *  array when it already is, undefined when the field is absent. */
function carriedPrograms(raw: unknown, programId: string): AdditionalProgram[] | undefined {
  if (raw === undefined) return undefined;
  const shaped = ADDITIONAL_PROGRAMS.parse(raw) ?? [];
  const canonical = canonicalAdditionalPrograms(shaped, programId);
  return JSON.stringify(canonical) === JSON.stringify(raw) ? (raw as AdditionalProgram[]) : canonical;
}

/** Student content a plan copy would keep: courses, tried classes (spec 028
 *  D12), course marks (spec 020), added short-term columns (spec 042 D4) or
 *  extra programs (spec 047 D2).
 *  An A&S / CALS student often starts with an empty board and only tried
 *  classes. */
function hasContent(c: CarryPlanContent): boolean {
  return (
    (Array.isArray(c.placements) && c.placements.length > 0) ||
    (Array.isArray(c.triedCourseIds) && c.triedCourseIds.length > 0) ||
    (!!c.courseMarks && Object.keys(c.courseMarks).length > 0) ||
    (Array.isArray(c.shortTerms) && c.shortTerms.length > 0) ||
    (Array.isArray(c.additionalPrograms) && c.additionalPrograms.length > 0)
  );
}

/**
 * Worth copying (spec 018 D3): has content (courses, tried classes or course
 * marks), and was saved after being created. A starter board rides in the
 * create itself, so an untouched one has equal created/updated times. A
 * missing time counts as edited (copy rather than lose).
 */
export function shouldCarry(p: CarryPlan): boolean {
  if (p.legacy || !hasContent(p.content)) return false;
  if (p.createdAtMs === null || p.updatedAtMs === null) return true;
  return p.updatedAtMs !== p.createdAtMs;
}

/** The copy's name (spec 018 D4): unchanged when free, else labeled and numbered. */
export function carryName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (from guest)" : ` (from guest ${n})`;
    const candidate = name.slice(0, MAX_PLAN_NAME - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The copies to write, in the guest's order, named against the account's plans
 *  and each other. */
export function planCopies(
  guestPlans: CarryPlan[],
  accountPlanNames: string[],
  newId: () => string
): CarryCopy[] {
  const taken = new Set(accountPlanNames);
  const copies: CarryCopy[] = [];
  for (const p of guestPlans) {
    if (!shouldCarry(p)) continue;
    const name = carryName(p.content.name, taken);
    taken.add(name);
    copies.push({ fromId: p.id, newId: newId(), input: { ...p.content, name } });
  }
  return copies;
}

/** The account's next active plan (spec 018 D2): the copy of the plan the guest
 *  was editing, or null to leave the account's choice alone. */
export function activePlanAfterCarry(
  guestActivePlanId: string | null,
  copies: CarryCopy[]
): string | null {
  if (!guestActivePlanId) return null;
  return copies.find((c) => c.fromId === guestActivePlanId)?.newId ?? null;
}

function unionCapped(first: string[], second: string[], cap: number): string[] {
  const out = [...first];
  for (const id of second) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The account's profile patch (spec 018 D5): favorites and pins unioned (the
 * account's first, capped); credits and start year only where the account has
 * none. Only fields that actually change are present.
 */
export function profileGapFill(account: CarryProfile, guest: CarryProfile): ProfileCarryPatch {
  const patch: ProfileCarryPatch = {};
  const favorites = unionCapped(account.favoriteCourseIds, guest.favoriteCourseIds, MAX_FAVORITES);
  if (favorites.length > account.favoriteCourseIds.length) patch.favoriteCourseIds = favorites;
  const pins = unionCapped(account.pinnedCourseIds, guest.pinnedCourseIds, MAX_PINS);
  if (pins.length > account.pinnedCourseIds.length) patch.pinnedCourseIds = pins;
  if (account.creditProfile.length === 0 && guest.creditProfile.length > 0) {
    patch.creditProfile = guest.creditProfile;
  }
  if (account.enteringYear === null && guest.enteringYear !== null) {
    patch.enteringYear = guest.enteringYear;
  }
  return patch;
}

/**
 * The account's student-prefs patch (spec 019): the guest's answers, carried
 * like the start year, only where the account hasn't answered.
 *  - The start answers (start term, transfer, transfer standing) travel
 *    together (a standing means nothing without its transfer kind): carried
 *    only into an account with none of them, and only when the guest's start
 *    term agrees with the account's own start year if it has one — otherwise
 *    the engine would read one start and the semester labels another.
 *  - The college carries on its own, into an account with no college.
 *  - Student facts (spec 020) merge question by question (answersGapFill).
 * Only the guest's answered (non-null) fields are present.
 */
export function studentPrefsGapFill(
  account: CarryProfile,
  guest: CarryProfile
): Partial<CarryStudentPrefs> {
  const accountPrefs = account.studentPrefs ?? {};
  const guestPrefs = guest.studentPrefs ?? {};
  const patch: Partial<CarryStudentPrefs> = {};

  const START_KEYS = ["entryTerm", "transfer", "transferStanding"] as const;
  const accountHasStart = START_KEYS.some((k) => accountPrefs[k] != null);
  const guestYear = guestPrefs.entryTerm != null ? enteringYearForEntryTerm(guestPrefs.entryTerm) : null;
  const yearsAgree = account.enteringYear == null || guestYear == null || guestYear === account.enteringYear;
  if (!accountHasStart && yearsAgree) {
    if (guestPrefs.entryTerm != null) patch.entryTerm = guestPrefs.entryTerm;
    if (guestPrefs.transfer != null) patch.transfer = guestPrefs.transfer;
    if (guestPrefs.transferStanding != null) patch.transferStanding = guestPrefs.transferStanding;
  }
  // The concentration belongs to a major, not to the start answers: carried
  // into an account with none (it applies only while that major is selected).
  if (accountPrefs.concentration == null && guestPrefs.concentration != null) {
    patch.concentration = guestPrefs.concentration;
  }
  if (accountPrefs.college == null && guestPrefs.college != null) patch.college = guestPrefs.college;
  const answers = answersGapFill(accountPrefs.answers ?? {}, guestPrefs.answers ?? {});
  if (answers) patch.answers = answers;
  return patch;
}

/**
 * Spec 020 D10: the guest's student facts merged into the account's, per
 * question. The account's own answer always wins; a question only the guest
 * answered is added, in the guest's order, up to MAX_FACT_ANSWERS. Returns the
 * whole merged map (it is written as one map), or null when nothing is added.
 */
export function answersGapFill(
  account: Record<string, FactValue>,
  guest: Record<string, FactValue>
): Record<string, FactValue> | null {
  const merged: Record<string, FactValue> = { ...account };
  let count = Object.keys(merged).length;
  let added = false;
  for (const [key, value] of Object.entries(guest)) {
    if (count >= MAX_FACT_ANSWERS) break;
    if (key in merged) continue;
    merged[key] = value;
    count++;
    added = true;
  }
  return added ? merged : null;
}
