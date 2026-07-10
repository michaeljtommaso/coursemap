import {
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

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
 *  return unsub). Never throws; onAuthStateChanged errors surface to the cb's
 *  error arm which we log. */
export function onAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(
    auth,
    (user) => cb(user),
    (err) => {
      console.warn("[auth] onAuthStateChanged error", err);
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
 * We fall back to signInWithPopup, which switches the session to that existing
 * account. CONSEQUENCE: the plans created under THIS anonymous uid are orphaned —
 * they stay in Firestore under the old anon uid but are no longer reachable by
 * the (now Google) session. This is acceptable beta debris (spec 002 §8c
 * anonymous-account hygiene); a later Admin sweep can reap orphaned anon plans.
 *
 * Returns `null` (not a throw) when the user closes the popup or a second
 * popup request pre-empts the first — that's the user changing their mind,
 * not an error, so callers shouldn't surface it. Every other failure still
 * throws so real errors keep surfacing however the caller currently does that.
 */
export async function linkWithGoogle(): Promise<{
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
        // Orphaned-anon-plan consequence documented above.
        const cred = await signInWithPopup(auth, googleProvider);
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
