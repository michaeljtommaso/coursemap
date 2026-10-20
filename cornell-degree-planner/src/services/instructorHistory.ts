import { doc, getDoc, type Firestore } from "firebase/firestore";
import {
  CourseInstructorHistorySchema,
  type CourseInstructorHistoryDoc,
} from "@/lib/schemas";

/**
 * instructorHistory.ts (spec 017 D8) — the one reader for
 * courseInstructorHistory/{courseId}, shared by the course panel (through the
 * reviews adapter) and the future-term cards.
 *
 * READ DISCIPLINE:
 *  - get-by-id only, never a collection scan;
 *  - one read per distinct course per session: the in-flight promise is cached,
 *    so cards mounting together share a single request, and a not-found doc is
 *    cached as null so it is never re-read;
 *  - a failed read resolves to null and is NOT cached, so a later mount can try
 *    again (no claim from missing data either way).
 *
 * Independent of the ratings switch: instructor names are Cornell roster data,
 * so the "last time" line can show names even when ratings are off.
 */

type Loader = (courseId: string) => Promise<CourseInstructorHistoryDoc | null>;

const cache = new Map<string, Promise<CourseInstructorHistoryDoc | null>>();

// firebase.ts initializes the app on import, so it is loaded lazily: importing
// this module must not pull Firebase in (unit tests, the null provider).
let dbPromise: Promise<Firestore> | null = null;
function getDb(): Promise<Firestore> {
  if (!dbPromise) dbPromise = import("@/lib/firebase").then((m) => m.db);
  return dbPromise;
}

const firestoreLoader: Loader = async (courseId) => {
  const db = await getDb();
  const snap = await getDoc(doc(db, "courseInstructorHistory", courseId));
  if (!snap.exists()) return null;
  const parsed = CourseInstructorHistorySchema.safeParse(snap.data());
  return parsed.success ? parsed.data : null;
};

let loader: Loader = firestoreLoader;

/** The course's instructor history doc, or null when absent, malformed, or the
 *  read failed. Cached per course id for the session. */
export function getInstructorHistory(
  courseId: string | null | undefined
): Promise<CourseInstructorHistoryDoc | null> {
  if (!courseId) return Promise.resolve(null);
  const hit = cache.get(courseId);
  if (hit) return hit;
  const pending = loader(courseId).catch(() => {
    cache.delete(courseId);
    return null;
  });
  cache.set(courseId, pending);
  return pending;
}

/** Test seam: swap the loader and clear the cache. Pass nothing to restore the
 *  Firestore loader. */
export function __setInstructorHistoryLoaderForTests(next?: Loader): void {
  loader = next ?? firestoreLoader;
  cache.clear();
}
