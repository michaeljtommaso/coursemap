// scripts/admin-app.ts
// One Admin SDK init for scripts that may run against either the live project
// or the local Firestore emulator.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080  → the emulator; no credentials are
//                                              loaded, so nothing can reach prod
//   otherwise                                → the live project, which requires
//                                              GOOGLE_APPLICATION_CREDENTIALS

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export const PROJECT_ID = "degree-planner-app";

export function emulatorHost(): string | null {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  return host && host.trim() ? host.trim() : null;
}

/** Initialise the Admin SDK and return Firestore. Exits on missing credentials
 *  for a live run. Logs which backend is in use. */
export function initAdmin(): Firestore {
  const host = emulatorHost();
  if (host) {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      console.error(`FIRESTORE_EMULATOR_HOST="${host}" is not a local address; refusing.`);
      process.exit(1);
    }
    initializeApp({ projectId: PROJECT_ID });
    console.log(`   backend: Firestore EMULATOR at ${host}`);
  } else {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error(
        "GOOGLE_APPLICATION_CREDENTIALS is unset. Point it at the service-account key " +
          "(never commit or echo it), or set FIRESTORE_EMULATOR_HOST to use the emulator."
      );
      process.exit(1);
    }
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log(`   backend: LIVE project ${PROJECT_ID}`);
  }
  return getFirestore();
}
