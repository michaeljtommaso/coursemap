import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserProfileSchema, type UserProfileDoc } from "@/lib/schemas";

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
  prefs: { theme?: string };
  activePlanId: string | null;
  importedLocalPlan: boolean;
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

/** Patch mutable profile fields (activePlanId, importedLocalPlan, prefs, etc.). */
export async function updateProfile(
  uid: string,
  patch: Partial<{
    displayName: string | null;
    authProvider: string;
    activePlanId: string | null;
    importedLocalPlan: boolean;
    prefs: { theme?: string };
  }>
): Promise<void> {
  UserProfileSchema.partial().parse(patch);
  await updateDoc(profileDoc(uid), patch);
}
