import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import { ensureAnonAuth, onAuth, linkWithGoogle, signOutUser } from "@/services/auth";
import {
  fetchProfile,
  createProfile,
  updateProfile,
  updatePrefs,
  toggleFavorite as toggleFavoriteDoc,
  type Profile,
} from "@/services/profile";
import { createPlan } from "@/services/plans";
import { readLocalPlanForImport, clearCapturedLocalPlan } from "@/lib/importLocalPlan";
import { useThemeStore } from "@/store/useThemeStore";

/**
 * AuthProvider (docs/specs/002 §7) — mounted ABOVE the data providers in App.tsx.
 * Responsibilities:
 *   1. Silent signInAnonymously() on first load (always a uid, no UI friction).
 *   2. Resolve users/{uid} profile; create it client-side on first auth.
 *   3. localStorage import: on first authed boot, if `cornell-planner-v2` exists
 *      and profile.importedLocalPlan != true, transform it into a plan doc, set
 *      activePlanId + importedLocalPlan:true (localStorage left intact).
 *   4. Google link-upgrade (linkWithGoogle) exposed for TopBar's "Save your plan".
 *
 * loading STAYS TRUE until the profile doc resolves — consumers (PlanProvider,
 * shell) must not act before there's a uid + profile.
 */

type AuthContextValue = {
  user: User | null;
  uid: string | null;
  profile: Profile | null;
  loading: boolean;
  error: Error | null;
  isAnonymous: boolean;
  /** Upgrade anon → Google. Returns whether it fell back to a fresh sign-in
   *  (orphaning this anon account's plans — see services/auth.ts), or
   *  `cancelled: true` if the user closed the popup without signing in
   *  (triage #22 — not an error, no loading state should get stuck on it). */
  linkGoogle: () => Promise<{ fellBackToSignIn: boolean; cancelled: boolean }>;
  /** Sign out of the Google account (spec 006 §C4). Boots a fresh anonymous
   *  session immediately so there's always a uid to plan against. */
  signOut: () => Promise<void>;
  /** Let PlanProvider report the active plan id back to the profile. */
  setActivePlanId: (planId: string) => Promise<void>;
  /** Entering year (spec 004: real semester labels). Null until the student sets it. */
  enteringYear: number | null;
  setEnteringYear: (year: number) => Promise<void>;
  /** First name for quiet identity touches (Google display name's first token). */
  firstName: string | null;
  /** Favorited course ids (spec 006 §E4) — profile-level, works for anon uids. */
  favoriteCourseIds: string[];
  /** Toggle a course favorite (optimistic + arrayUnion/Remove write). */
  toggleFavorite: (courseId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Client mirror of the firestore.rules favorites cap (favoriteCourseIds ≤ 200). */
const MAX_FAVORITES = 200;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Guards: ensureAnonAuth kicked off once; per-uid profile resolution once.
  const bootRef = useRef(false);
  const resolvedUidRef = useRef<string | null>(null);
  const theme = useThemeStore.getState().theme;

  // 1. Kick off anonymous sign-in once, and subscribe to auth state.
  useEffect(() => {
    const unsub = onAuth((u) => setUser(u));
    if (!bootRef.current) {
      bootRef.current = true;
      ensureAnonAuth().catch((err) => {
        // e.g. auth/operation-not-allowed when Anonymous sign-in isn't enabled in
        // the console. Surface it; the app can't cloud-save without a uid.
        console.warn("[auth] ensureAnonAuth failed", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    }
    return unsub;
  }, []);

  // 2/3. Resolve (or create) the profile when the uid appears; run the one-time
  // localStorage import. Re-runs only when the uid actually changes.
  useEffect(() => {
    const u = user;
    if (!u) return;
    if (resolvedUidRef.current === u.uid) return;
    resolvedUidRef.current = u.uid;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const provider = u.isAnonymous ? "anonymous" : "google.com";
        let prof = await fetchProfile(u.uid);
        if (!prof) {
          prof = await createProfile(u.uid, {
            authProvider: provider,
            displayName: u.displayName ?? null,
            theme,
          });
        }

        // localStorage import — once per profile, first authed boot only.
        if (!prof.importedLocalPlan) {
          const imported = readLocalPlanForImport();
          if (imported) {
            const planId = crypto.randomUUID();
            await createPlan(u.uid, planId, imported);
            await updateProfile(u.uid, {
              importedLocalPlan: true,
              activePlanId: planId,
            });
            prof = { ...prof, importedLocalPlan: true, activePlanId: planId };
            // The import may only ever run once per page load — a fresh anon
            // profile after sign-out must NOT re-import the boot snapshot.
            clearCapturedLocalPlan();
          } else {
            // Nothing to import — still mark it so we don't re-scan every boot.
            await updateProfile(u.uid, { importedLocalPlan: true });
            prof = { ...prof, importedLocalPlan: true };
          }
        }

        if (!cancelled) setProfile(prof);
      } catch (err) {
        if (!cancelled) {
          console.warn("[auth] profile resolution failed", err);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, theme]);

  // Mirror theme → users/{uid}.prefs.theme when authed (self-write, spec 002 §6).
  // useThemeStore stays the localStorage source of truth; this is a best-effort
  // cloud mirror so a Google-linked user's theme can travel later. Skips the
  // initial paint (profile create already seeded theme) and any pre-profile tick.
  const themeMirroredRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = resolvedUidRef.current;
    if (!uid || !profile) return;
    if (themeMirroredRef.current === null) {
      // First run after profile resolves — record without writing (already seeded).
      themeMirroredRef.current = theme;
      return;
    }
    if (themeMirroredRef.current === theme) return;
    themeMirroredRef.current = theme;
    // Dot-path merge — a whole-map prefs write would wipe enteringYear.
    updatePrefs(uid, { theme }).catch((err) =>
      console.warn("[auth] theme mirror failed", err)
    );
  }, [theme, profile]);

  const linkGoogle = useMemo(
    () => async () => {
      const result = await linkWithGoogle();
      if (!result) {
        // User closed the popup — their choice, not a failure. Nothing to
        // update, nothing to surface.
        return { fellBackToSignIn: false, cancelled: true };
      }
      const { user: linked, fellBackToSignIn } = result;
      // Update the profile's authProvider (best-effort; the onAuth listener will
      // re-resolve the profile if the uid changed on a fallback sign-in).
      try {
        await updateProfile(linked.uid, {
          authProvider: "google.com",
          displayName: linked.displayName ?? null,
        });
      } catch (err) {
        console.warn("[auth] post-link profile update failed", err);
      }
      // Force a profile re-resolve on the next uid tick (fallback sign-in swaps uid).
      if (fellBackToSignIn) resolvedUidRef.current = null;
      return { fellBackToSignIn, cancelled: false };
    },
    []
  );

  const signOut = useMemo(
    () => async () => {
      // Sign out of Google, then immediately re-anon so the app never sits
      // without a uid. The onAuth listener drives the uid switch: user → null
      // (Google) → new anonymous user. resolvedUidRef is left as-is; the new
      // anon uid differs from the old one, so the profile effect re-resolves
      // (and PlanProvider's [uid, planId] subscription tears down and re-runs).
      // Never throws — callers (LeftSidebar) await it bare; a failure surfaces
      // through the existing `error` state instead of silently pretending a
      // uid exists.
      try {
        await signOutUser();
        await ensureAnonAuth();
      } catch (err) {
        console.warn("[auth] signOut failed", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    []
  );

  const setActivePlanId = useMemo(
    () => async (planId: string) => {
      const uid = resolvedUidRef.current;
      if (!uid) return;
      await updateProfile(uid, { activePlanId: planId });
      setProfile((p) => (p ? { ...p, activePlanId: planId } : p));
    },
    []
  );

  // Latest favorites, read synchronously in toggleFavorite (a state updater's
  // body is NOT guaranteed to run before the next statement, so the write
  // direction can't be captured inside setProfile).
  const favoritesRef = useRef<string[]>([]);
  favoritesRef.current = profile?.favoriteCourseIds ?? [];

  const toggleFavorite = useMemo(
    () => async (courseId: string) => {
      const uid = resolvedUidRef.current;
      if (!uid) return;
      const previous = favoritesRef.current;
      const makeFavorite = !previous.includes(courseId);
      // Client-side mirror of the firestore.rules cap (favoriteCourseIds ≤ 200):
      // adding at the cap would be rejected server-side anyway — no-op instead
      // of an optimistic add that's guaranteed to need reverting.
      if (makeFavorite && previous.length >= MAX_FAVORITES) return;
      // Optimistic toggle (pure updater — no decision-carrying side effects).
      setProfile((p) =>
        p
          ? {
              ...p,
              favoriteCourseIds: makeFavorite
                ? [...p.favoriteCourseIds, courseId]
                : p.favoriteCourseIds.filter((id) => id !== courseId),
            }
          : p
      );
      await toggleFavoriteDoc(uid, courseId, makeFavorite).catch((err) => {
        console.warn("[auth] favorite toggle failed", err);
        // The write never landed — roll the optimistic toggle back so the star
        // doesn't lie about persisted state.
        setProfile((p) => (p ? { ...p, favoriteCourseIds: previous } : p));
      });
    },
    []
  );

  const setEnteringYear = useMemo(
    () => async (year: number) => {
      const uid = resolvedUidRef.current;
      if (!uid) return;
      setProfile((p) =>
        p ? { ...p, prefs: { ...p.prefs, enteringYear: year } } : p
      );
      await updatePrefs(uid, { enteringYear: year }).catch((err) =>
        console.warn("[auth] enteringYear write failed", err)
      );
    },
    []
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      uid: user?.uid ?? null,
      profile,
      loading,
      error,
      isAnonymous: user?.isAnonymous ?? true,
      linkGoogle,
      signOut,
      setActivePlanId,
      enteringYear: profile?.prefs?.enteringYear ?? null,
      setEnteringYear,
      firstName:
        (!user?.isAnonymous && user?.displayName?.split(" ")[0]) ||
        (profile?.displayName?.split(" ")[0] ?? null) ||
        null,
      favoriteCourseIds: profile?.favoriteCourseIds ?? [],
      toggleFavorite,
    }),
    [user, profile, loading, error, linkGoogle, signOut, setActivePlanId, setEnteringYear, toggleFavorite]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
