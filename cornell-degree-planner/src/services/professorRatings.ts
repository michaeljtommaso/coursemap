import { doc, getDoc } from "firebase/firestore";
import { FEATURES } from "@/config/features";
import {
  EMPTY_RATINGS,
  ratingsFromDoc,
  type ProfessorRatingsMap,
} from "@/lib/classes/professorRatings";

/**
 * catalog/professorRatings loader (spec 017 D5) — ONE get-by-id read per page
 * load, never a collection scan. The promise is cached at module level, so every
 * caller on the page shares the same read. With the ratings feature off there is
 * no read at all. A missing doc or a failed read resolves to an empty map: rows
 * keep their professor names and the well-rated chip hides; no error surface.
 */

let pending: Promise<ProfessorRatingsMap> | null = null;
let settled: ProfessorRatingsMap | null = null;

async function readRatingsDoc(): Promise<unknown | null> {
  // firebase.ts initializes the app on import, so it's loaded lazily here (the
  // same seam the reviews adapter uses).
  const { db } = await import("@/lib/firebase");
  const snap = await getDoc(doc(db, "catalog", "professorRatings"));
  return snap.exists() ? snap.data() : null;
}

export function loadProfessorRatings(
  enabled: boolean = FEATURES.rateMyProfessor,
  now: () => number = Date.now
): Promise<ProfessorRatingsMap> {
  if (!enabled) return Promise.resolve(EMPTY_RATINGS);
  if (!pending) {
    pending = readRatingsDoc()
      .then((data) => (data == null ? EMPTY_RATINGS : ratingsFromDoc(data, now())))
      .catch((err: unknown) => {
        console.warn("[catalog] professor ratings unavailable", err);
        return EMPTY_RATINGS;
      })
      .then((map) => {
        settled = map;
        return map;
      });
  }
  return pending;
}

/** The loaded map if the read has already settled this page load, else null —
 *  lets a remounting page render ratings on its first pass. */
export function peekProfessorRatings(): ProfessorRatingsMap | null {
  return settled;
}

/** Test seam: forget the cached read. */
export function resetProfessorRatingsCache(): void {
  pending = null;
  settled = null;
}
