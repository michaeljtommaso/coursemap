import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { z } from "zod";
import {
  UserProfileSchema,
  CreditEntrySchema,
  type UserProfileDoc,
  type CreditEntry,
} from "@/lib/schemas";
import type { ProfileCarryPatch } from "@/lib/guestCarryOver";

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
  prefs: { theme?: string; enteringYear?: number };
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
  prefs: Partial<{ theme: string; enteringYear: number }>
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (prefs.theme !== undefined) patch["prefs.theme"] = prefs.theme;
  if (prefs.enteringYear !== undefined) patch["prefs.enteringYear"] = prefs.enteringYear;
  if (Object.keys(patch).length === 0) return;
  await updateDoc(profileDoc(uid), patch);
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
