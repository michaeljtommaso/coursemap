import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  deleteField,
  FieldPath,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { z } from "zod";
import {
  UserProfileSchema,
  CreditEntrySchema,
  AnswerKeySchema,
  FactAnswersSchema,
  FactValueSchema,
  MAX_FACT_ANSWERS,
  type UserProfileDoc,
  type CreditEntry,
} from "@/lib/schemas";
import type { ProfileCarryPatch } from "@/lib/guestCarryOver";
import type { CollegeId } from "@/lib/planner/colleges";
import type { ClassStanding, FactValue, TransferKind } from "@/lib/planner/distribution/types";

/** Spec 019 D10/D11 — what the student told us about their start at Cornell
 *  (selectLayers needs it) and their college (Major Match scope). Stored in
 *  `prefs`; null = not answered / cleared. */
export type StudentPrefs = {
  /** Roster slug of the first term at Cornell ("FA25"). */
  entryTerm: string | null;
  transfer: TransferKind | null;
  /** Class standing a transfer student arrived at (transfers only). */
  transferStanding: ClassStanding | null;
  college: CollegeId | null;
  /** The concentration(s) chosen for one major. `ids` count only while
   *  `programId` is the current major, so switching majors clears it. */
  concentration: { programId: string; ids: string[] } | null;
  /** Spec 020 D2: student facts, answer key (questions/keys.ts) → "yes" /
   *  "no". Optional here so a prefs object written before spec 020 still
   *  type-checks; `useAuth().studentContext` always fills it (see
   *  StudentContext). Answering writes ONE key (writeFactAnswer, through a
   *  FieldPath, which takes keys with ":" "/" "@" as they are), so a tab
   *  holding an old copy of the map never erases answers made elsewhere.
   *  updatePrefs still writes the whole map (the guest carry-over). */
  answers?: Record<string, FactValue>;
};
/** StudentPrefs as `useAuth().studentContext` exposes it: answers always
 *  present (empty when the student has answered nothing). */
export type StudentContext = StudentPrefs & { answers: Record<string, FactValue> };
export const STUDENT_PREF_KEYS = ["entryTerm", "transfer", "transferStanding", "college", "concentration"] as const;
/** rules: prefs.size() <= 20 — keep in sync with firestore.rules. The app
 *  writes 8 prefs keys: theme, enteringYear, the five STUDENT_PREF_KEYS and
 *  answers; the rest is headroom. */
export const MAX_PREFS_KEYS = 20;

/**
 * The student-facts map after answering `key` with `value` (null clears it),
 * spec 020. "same" when nothing changes; "cap" when a NEW answer would pass
 * MAX_FACT_ANSWERS; "invalid" when the key or value is malformed (the strict
 * FactAnswersSchema updatePrefs runs). A cleared answer is deleted from the
 * map, never stored as null. Pure.
 */
export function nextFactAnswers(
  cur: Record<string, FactValue>,
  key: string,
  value: FactValue | null
): Record<string, FactValue> | "same" | "cap" | "invalid" {
  if (value === null ? !(key in cur) : cur[key] === value) return "same";
  if (value !== null && !(key in cur) && Object.keys(cur).length >= MAX_FACT_ANSWERS) return "cap";
  const next = { ...cur };
  if (value === null) delete next[key];
  else next[key] = value;
  return FactAnswersSchema.safeParse(next).success ? next : "invalid";
}

/** `answers` with `key` set to `value`, or removed for null. Pure. */
function withFact(
  answers: Record<string, FactValue> | undefined,
  key: string,
  value: FactValue | null | undefined
): Record<string, FactValue> {
  const out = { ...(answers ?? {}) };
  if (value == null) delete out[key];
  else out[key] = value;
  return out;
}

/** What createFactAnswerSetter needs from its host (AuthProvider). */
export type FactAnswerSetterDeps = {
  /** Resolves once the profile is loaded (nothing is lost on first run). */
  ready: () => Promise<void>;
  /** The signed-in uid, or null. */
  uid: () => string | null;
  /** The latest local facts, read synchronously so two quick answers build on
   *  each other. */
  getAnswers: () => Record<string, FactValue>;
  /** Apply a change to the local facts (the update receives the latest map). */
  setAnswers: (update: (cur: Record<string, FactValue> | undefined) => Record<string, FactValue>) => void;
  /** A write the server refused or that failed; the answer is already reverted. */
  onWriteFailed: (err: unknown) => void;
  /** The one-key write (tests inject a fake). */
  write?: (uid: string, key: string, value: FactValue | null) => Promise<void>;
};

/**
 * The student-fact setter (spec 020 D2): answer, or with null clear, one fact.
 *
 * Optimistic: the answer applies locally and the promise resolves at once.
 * The write goes out without being awaited, because a Firestore write resolves
 * only when the server acknowledges it, so an offline save would otherwise
 * wait indefinitely. It writes only this key (writeFactAnswer), so answers
 * saved from another tab are never overwritten. When the write is refused
 * (for example the rules' 30-answer cap, reached from another tab) or fails,
 * only this answer is put back and `onWriteFailed` runs.
 *
 * The cap and malformed-answer checks run first, against the local map, and
 * reject with a message fit to show the student; nothing is applied then.
 */
export function createFactAnswerSetter(
  deps: FactAnswerSetterDeps
): (key: string, value: FactValue | null) => Promise<void> {
  const write = deps.write ?? writeFactAnswer;
  return async (key, value) => {
    await deps.ready();
    const uid = deps.uid();
    if (!uid) return;
    const current = deps.getAnswers();
    const next = nextFactAnswers(current, key, value);
    if (next === "same") return;
    if (next === "cap") {
      throw new Error(`You can save up to ${MAX_FACT_ANSWERS} answers about yourself. Clear one to add another.`);
    }
    if (next === "invalid") throw new Error("That answer couldn't be saved.");
    const previous = current[key];
    deps.setAnswers((cur) => withFact(cur, key, value));
    void write(uid, key, value).catch((err: unknown) => {
      // Put this one answer back as it was (other answers made meanwhile stay).
      deps.setAnswers((cur) => withFact(cur, key, previous));
      deps.onWriteFailed(err);
    });
  };
}

/**
 * Profile service — the ONLY module that touches the users/{uid} profile doc
 * (house-standard service-layer contract, docs/specs/002 §5). The profile is created
 * CLIENT-SIDE on first auth (spec 002 §7) — acceptable deviation from the house standard's
 * server-side-only profile creation because there are no roles/privileges to
 * protect yet (rules constrain the exact shape). TRIPWIRE: if any
 * privilege-granting field ever appears, profile creation must move server-side.
 */

export type Profile = {
  createdAt: unknown;
  displayName: string | null;
  authProvider: string;
  prefs: { theme?: string; enteringYear?: number } & Partial<StudentPrefs>;
  activePlanId: string | null;
  importedLocalPlan: boolean;
  favoriteCourseIds: string[];
  /** Pinned courses for the compare tray (spec 013 §2). */
  pinnedCourseIds: string[];
  /** Credit profile (spec 007 §2) — AP/IB/transfer/placement entries. */
  creditProfile: CreditEntry[];
};

function profileDoc(uid: string) {
  return doc(db, "users", uid);
}

function toProfile(d: UserProfileDoc): Profile {
  return {
    createdAt: d.createdAt ?? null,
    displayName: d.displayName ?? null,
    authProvider: d.authProvider ?? "anonymous",
    prefs: d.prefs ?? {},
    activePlanId: d.activePlanId ?? null,
    importedLocalPlan: d.importedLocalPlan ?? false,
    favoriteCourseIds: d.favoriteCourseIds ?? [],
    pinnedCourseIds: d.pinnedCourseIds ?? [],
    creditProfile: d.creditProfile ?? [],
  };
}

/** Read the profile doc, or null if it doesn't exist yet. */
export async function fetchProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(profileDoc(uid));
  if (!snap.exists()) return null;
  return toProfile(UserProfileSchema.parse(snap.data()));
}

/**
 * Create the profile on first auth. Shape is exactly the rules allowlist
 * (createdAt, displayName, authProvider, prefs, activePlanId, importedLocalPlan).
 * theme mirrors the local theme store when known (self-write, spec 002 §6).
 */
export async function createProfile(
  uid: string,
  opts: { authProvider: string; displayName?: string | null; theme?: string }
): Promise<Profile> {
  const payload = {
    createdAt: serverTimestamp(),
    displayName: opts.displayName ?? null,
    authProvider: opts.authProvider,
    prefs: opts.theme ? { theme: opts.theme } : {},
    activePlanId: null,
    importedLocalPlan: false,
  };
  // Validate the JSON-visible slice (createdAt sentinel replaced for the check).
  UserProfileSchema.parse({ ...payload, createdAt: new Date() });
  await setDoc(profileDoc(uid), payload);
  return toProfile({ ...payload, createdAt: null } as UserProfileDoc);
}

/**
 * Merge individual prefs via dot-paths. NEVER pass a whole `prefs` map to
 * updateProfile for a single pref — updateDoc replaces map fields wholesale,
 * which would wipe the other prefs (e.g. theme mirror erasing enteringYear).
 */
export async function updatePrefs(
  uid: string,
  prefs: Partial<{ theme: string; enteringYear: number } & StudentPrefs>
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (prefs.theme !== undefined) patch["prefs.theme"] = prefs.theme;
  if (prefs.enteringYear !== undefined) patch["prefs.enteringYear"] = prefs.enteringYear;
  // Spec 019 — null clears a field (e.g. transferStanding after "not a transfer").
  for (const key of STUDENT_PREF_KEYS) {
    if (prefs[key] !== undefined) patch[`prefs.${key}`] = prefs[key];
  }
  // Spec 020: the whole answers map replaces the stored one (a cleared answer
  // is absent from the map, never stored as null). Used for a one-shot copy
  // (the guest carry-over); answering one question goes through
  // writeFactAnswer instead. Strictly validated first: a malformed key or more
  // than MAX_FACT_ANSWERS entries never reaches the wire (rules:
  // prefs.answers.size() <= 30 is the server boundary).
  if (prefs.answers !== undefined) {
    patch["prefs.answers"] = FactAnswersSchema.parse(prefs.answers);
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(profileDoc(uid), patch);
}

/**
 * Write ONE student fact (spec 020 D2): `prefs.answers.<key>` set to `value`,
 * or deleted for null. A FieldPath carries the key as one segment, so its
 * ":" "/" "@" need no escaping, and the other stored answers are untouched
 * (a stale local copy of the map can't erase answers saved elsewhere). The
 * key and value are validated first; the rules check the resulting map's
 * size (prefs.answers.size() <= 30) and refuse a write past it.
 */
export async function writeFactAnswer(uid: string, key: string, value: FactValue | null): Promise<void> {
  AnswerKeySchema.parse(key);
  if (value !== null) FactValueSchema.parse(value);
  await updateDoc(
    profileDoc(uid),
    new FieldPath("prefs", "answers", key),
    value === null ? deleteField() : value
  );
}

/**
 * Toggle a course in the profile's favorites (spec 006 §E4). Uses arrayUnion /
 * arrayRemove so concurrent toggles from two tabs don't clobber each other; the
 * rules cap (favoriteCourseIds.size() <= 200) is checked against the post-write
 * array. NOT routed through updateProfile (that Zod-validates a plain array,
 * which would reject the FieldValue sentinel).
 */
export async function toggleFavorite(
  uid: string,
  courseId: string,
  makeFavorite: boolean
): Promise<void> {
  await updateDoc(profileDoc(uid), {
    favoriteCourseIds: makeFavorite ? arrayUnion(courseId) : arrayRemove(courseId),
  });
}

/**
 * Toggle a course in the profile's compare-tray pins (spec 013 §2). Mirrors
 * toggleFavorite exactly: arrayUnion / arrayRemove so concurrent toggles from
 * two tabs don't clobber each other; the rules cap (pinnedCourseIds.size() <= 8)
 * is the server boundary. NOT routed through updateProfile (that Zod-validates a
 * plain array, which would reject the FieldValue sentinel).
 */
export async function togglePin(
  uid: string,
  courseId: string,
  makePinned: boolean
): Promise<void> {
  await updateDoc(profileDoc(uid), {
    pinnedCourseIds: makePinned ? arrayUnion(courseId) : arrayRemove(courseId),
  });
}

/**
 * Replace the whole credit profile (spec 007 §2). Whole-array replace, not a
 * merge — there's a single editing surface (the profile editor, later unit)
 * and no concurrent-write need, unlike toggleFavorite's arrayUnion/Remove.
 * Zod-validates the array (cap 60) before writing so a corrupt/oversized
 * array never reaches the wire; firestore.rules is the authoritative cap.
 */
export async function updateCreditProfile(
  uid: string,
  entries: CreditEntry[]
): Promise<void> {
  z.array(CreditEntrySchema).max(60).parse(entries);
  await updateDoc(profileDoc(uid), { creditProfile: entries });
}

/** Patch mutable profile fields (activePlanId, importedLocalPlan, prefs, etc.). */
export async function updateProfile(
  uid: string,
  patch: Partial<{
    displayName: string | null;
    authProvider: string;
    activePlanId: string | null;
    importedLocalPlan: boolean;
    prefs: { theme?: string; enteringYear?: number };
  }>
): Promise<void> {
  UserProfileSchema.partial().parse(patch);
  await updateDoc(profileDoc(uid), patch);
}

/**
 * Apply a guest carry-over to an existing account's profile (spec 018 D2/D5):
 * filled-in favorites, pins, credits and start year, plus the new active plan.
 * The start year goes through a dot-path so the account's other prefs survive.
 */
export async function applyCarryOverToProfile(
  uid: string,
  patch: ProfileCarryPatch,
  activePlanId: string | null
): Promise<void> {
  const { enteringYear, ...lists } = patch;
  UserProfileSchema.partial().parse({
    ...lists,
    ...(enteringYear !== undefined ? { prefs: { enteringYear } } : {}),
    ...(activePlanId ? { activePlanId } : {}),
  });
  const write: Record<string, unknown> = { ...lists };
  if (enteringYear !== undefined) write["prefs.enteringYear"] = enteringYear;
  if (activePlanId) write.activePlanId = activePlanId;
  if (Object.keys(write).length === 0) return;
  await updateDoc(profileDoc(uid), write);
}
