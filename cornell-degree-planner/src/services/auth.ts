import {
  signInAnonymously,
  onIdTokenChanged,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signInWithCredential,
  signOut,
  updateProfile as updateAuthProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { accountIdentity } from "@/lib/authSnapshot";

/**
 * Auth service — the ONLY module that touches firebase/auth (house-standard
 * service-layer contract, docs/specs/002 §5/§7). Providers decided 2026-07-07:
 * anonymous + Google only (Cornell email is Google Workspace, so Google covers
 * cornell.edu). Anonymous sign-in is silent and automatic — testers land
 * planning, not registering.
 *
 * REQUIRES (manual, console-only): Anonymous + Google sign-in must be ENABLED in
 * Firebase console → Authentication → Sign-in method. On the free Spark tier this
 * is a Console click — it cannot be enabled via the Admin/Identity-Toolkit REST
 * API (that path returns BILLING_NOT_ENABLED / CONFIGURATION_NOT_FOUND until the
 * project is on Blaze). Until enabled, signInAnonymously() rejects with
 * auth/operation-not-allowed.
 */

const googleProvider = new GoogleAuthProvider();

/** Subscribe to auth state. Returns the unsubscribe fn (house-standard: subscribe →
 *  return unsub). Never throws; listener errors surface to the cb's error arm
 *  which we log.
 *
 *  Uses onIdTokenChanged, not onAuthStateChanged: the latter only fires when
 *  the uid changes, and linking an anonymous account to Google keeps the uid —
 *  so the app never heard about the link and kept showing "Sign in" until a
 *  reload. The ID token is refreshed on link, so this listener fires then too
 *  (and on sign-in, sign-out, and hourly refreshes, which callers dedupe). */
export function onAuth(cb: (user: User | null) => void): () => void {
  return onIdTokenChanged(
    auth,
    (user) => cb(user),
    (err) => {
      console.warn("[auth] onIdTokenChanged error", err);
      cb(null);
    }
  );
}

/**
 * Ensure there is always a signed-in user. If one already exists (persisted
 * anon/google session), return it; otherwise silently create an anonymous one.
 * Idempotent and safe to call on every boot.
 */
export async function ensureAnonAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/** Error codes Firebase throws when the user closes/abandons the popup
 *  themselves — this is user intent, not a failure, and every caller of
 *  linkWithGoogle should treat it identically (triage #22). Centralized here
 *  so no caller has to know Firebase's error-code vocabulary. */
const POPUP_CANCELLED_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

/**
 * Upgrade the current anonymous account to Google, KEEPING the same uid (so all
 * existing plans carry over). Uses linkWithPopup on the anonymous user.
 *
 * `credential-already-in-use`: the Google account was already linked to a
 * DIFFERENT Firebase user (e.g. the person signed in on another device before).
 * We switch the session to that existing account, signing in with the
 * credential the failed link returned, so no second popup opens (a popup
 * opened after an await is often blocked; spec 018 D6). Before switching,
 * `beforeSwitch(guestUid)` runs while the session is still the guest: the one
 * moment the guest's plans can be read, so they can be copied into the account
 * (spec 018). The guest's own docs stay behind under the old anon uid.
 *
 * Returns `null` (not a throw) when the user closes the popup or a second
 * popup request pre-empts the first — that's the user changing their mind,
 * not an error, so callers shouldn't surface it. Every other failure still
 * throws so real errors keep surfacing however the caller currently does that.
 */
export async function linkWithGoogle(opts: {
  beforeSwitch?: (guestUid: string) => Promise<void>;
} = {}): Promise<{
  user: User;
  fellBackToSignIn: boolean;
} | null> {
  const current = auth.currentUser;
  try {
    if (!current) {
      // No session at all — just sign in with Google.
      const cred = await signInWithPopup(auth, googleProvider);
      return { user: cred.user, fellBackToSignIn: true };
    }
    try {
      const cred = await linkWithPopup(current, googleProvider);
      return { user: cred.user, fellBackToSignIn: false };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/credential-already-in-use") {
        const credential = GoogleAuthProvider.credentialFromError(
          err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]
        );
        if (opts.beforeSwitch) {
          // Never lets a carry-over read failure block the sign-in itself.
          await opts.beforeSwitch(current.uid).catch((e) =>
            console.warn("[auth] beforeSwitch failed", e)
          );
        }
        const cred = credential
          ? await signInWithCredential(auth, credential)
          : await signInWithPopup(auth, googleProvider);
        return { user: cred.user, fellBackToSignIn: true };
      }
      throw err;
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code && POPUP_CANCELLED_CODES.has(code)) return null;
    throw err;
  }
}

/**
 * Sign the current (Google) user out (spec 006 §C4 — a new capability; nothing
 * signed out anywhere before this). The onAuth listener then fires with `null`;
 * AuthProvider's signOut wrapper immediately boots a fresh anonymous session via
 * ensureAnonAuth(), so the app never sits without a uid (there must always be
 * somewhere to save a plan — spec 002 §7). The now-anonymous session can later
 * re-link to Google, at which point linkWithGoogle's credential-already-in-use
 * fallback to signInWithPopup is the EXPECTED route back to their account.
 */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Copy the Google name and photo onto the account itself when they're missing.
 * A guest upgraded by linking Google keeps them only on the linked Google
 * entry, so the account record (and anything reading user.displayName) shows
 * no name. Best-effort: never throws.
 */
export async function healAccountProfile(user: User): Promise<void> {
  if (user.isAnonymous) return;
  const { displayName, photoURL } = accountIdentity(user);
  const patch: { displayName?: string; photoURL?: string } = {};
  if (!user.displayName && displayName) patch.displayName = displayName;
  if (!user.photoURL && photoURL) patch.photoURL = photoURL;
  if (Object.keys(patch).length === 0) return;
  try {
    await updateAuthProfile(user, patch);
  } catch (err) {
    console.warn("[auth] account name/photo backfill failed", err);
  }
}

