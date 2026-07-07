import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "firebase/app-check";

// Web config is PUBLIC client config, read from Vite env so the later prod
// project is a pure env swap (see docs/specs/002 §2). Never hardcode the config
// object here.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
  measurementId: import.meta.env.VITE_FB_MEASUREMENT_ID,
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

// ─── App Check (spec 002 §8c) ────────────────────────────────────────────────
// reCAPTCHA v3 attestation, gated behind VITE_FB_APPCHECK_SITE_KEY so a machine
// without the site key (or before App Check is registered in the console) boots
// cleanly instead of crashing. In dev we set the debug-token flag so the local
// origin passes without a real reCAPTCHA challenge; Firebase prints a debug token
// to register once in console → App Check → Manage debug tokens.
// Roll out monitor-first; enforce for Firestore before testers arrive.
const appCheckSiteKey = import.meta.env.VITE_FB_APPCHECK_SITE_KEY as
  | string
  | undefined;
if (appCheckSiteKey) {
  if (import.meta.env.DEV) {
    // Must be set BEFORE initializeAppCheck. Typed loosely — this is a Firebase
    // SDK global, not part of the standard lib DOM types.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      true;
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Never let an App Check init failure take down the app boot.
    console.warn("[appcheck] init failed; continuing without App Check", err);
  }
}

// ─── Analytics (spec 002 §2) ─────────────────────────────────────────────────
// Lazy, isSupported()-guarded, PROD-only so dev sessions don't pollute GA4.
// Fire-and-forget: analytics is telemetry, never on the critical path.
if (import.meta.env.PROD) {
  void import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) =>
      isSupported().then((ok) => {
        if (ok) getAnalytics(app);
      })
    )
    .catch(() => {
      /* analytics unavailable (blocked / unsupported) — ignore */
    });
}
