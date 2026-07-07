import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

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

// NOTE (stage 2): Auth (anonymous + Google) and App Check init land here per
// spec 002 §7/§8c. NOT initialized in stage 1.
//
// NOTE (stage 2): Analytics is deliberately NOT initialized in stage 1. When it
// is, do it lazily via isSupported().then(...) and only in import.meta.env.PROD
// so dev sessions don't pollute GA4 (spec 002 §2).
