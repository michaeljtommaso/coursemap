import { doc, getDoc, type Firestore } from "firebase/firestore";
import {
  ProfessorReviewsSchema,
  CourseInstructorHistorySchema,
  type ProfessorReviewsDoc,
  type CourseInstructorHistoryDoc,
} from "@/lib/schemas";
import {
  summaryFromDoc,
  courseViewFromDocs,
  type ProfessorReviewsDocLike,
  type CourseInstructorHistoryDocLike,
} from "@/lib/planner/reviews";
import type {
  ReviewsProvider,
  ProfessorSummary,
  CourseReviewView,
} from "./types";

/**
 * RmpAdapter (spec 013 §3, Unit 13B) — the RMP-backed ReviewsProvider. It reads
 * the two admin-written collections the offline pipeline populates and maps them
 * to the seam's shapes through the PURE mappers in lib/planner/reviews.ts (so
 * the staleness rule, the tier→confidence map, and the timeline assembly are all
 * unit-tested there, and this file stays a thin Firestore shell).
 *
 * READ DISCIPLINE (spec §3 / the read-budget law):
 *  - get-by-id ONLY — never a collection scan. professorReviews/{netid} and
 *    courseInstructorHistory/{courseId} are both direct doc reads.
 *  - in-memory cache per session — a netid/courseId is fetched at most once per
 *    page load; a NOT-FOUND is cached too (as null) so a missing professor
 *    doesn't re-hit Firestore on every card render.
 *
 * STALE-THEN-HIDDEN (spec §3b): summaryFromDoc returns null past the 90-day
 * staleness cutoff, so an aged rating auto-hides rather than showing as current.
 * getProfessorSummary therefore returns null for absent OR stale docs alike —
 * the surfaces render their honest empty state either way.
 *
 * NOTE: this adapter is NOT the shipped default this session. REVIEWS_PROVIDER
 * stays "null" (index.ts) until Michael runs the pipeline and flips the launch
 * switch — the collections are empty until then.
 */
export class RmpAdapter implements ReviewsProvider {
  // Per-session caches. `undefined` = not yet fetched; a stored `null` = fetched
  // and known-absent (negative cache), so we never re-read a missing doc.
  private summaryCache = new Map<string, ProfessorSummary | null>();
  private historyCache = new Map<string, CourseInstructorHistoryDoc | null>();

  /** "now" is injected once per adapter instance so a single render pass judges
   *  staleness against a stable clock (and tests can pin it via the subclass
   *  seam below). */
  protected now(): number {
    return Date.now();
  }

  // firebase.ts initializes App/Auth/App-Check on import (and throws without web
  // config), so it's imported LAZILY here — merely referencing RmpAdapter (as
  // index.ts does to register the "rmp" case) must not pull firebase in. Under
  // the shipped NullAdapter default these methods never run.
  private dbPromise: Promise<Firestore> | null = null;
  private getDb(): Promise<Firestore> {
    if (!this.dbPromise) {
      this.dbPromise = import("@/lib/firebase").then((m) => m.db);
    }
    return this.dbPromise;
  }

  private async fetchProfessorDoc(netid: string): Promise<ProfessorReviewsDoc | null> {
    const db = await this.getDb();
    const snap = await getDoc(doc(db, "professorReviews", netid));
    if (!snap.exists()) return null;
    const parsed = ProfessorReviewsSchema.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }

  private async fetchHistoryDoc(
    courseId: string
  ): Promise<CourseInstructorHistoryDoc | null> {
    const cached = this.historyCache.get(courseId);
    if (cached !== undefined) return cached;
    const db = await this.getDb();
    const snap = await getDoc(doc(db, "courseInstructorHistory", courseId));
    const val = snap.exists()
      ? (() => {
          const parsed = CourseInstructorHistorySchema.safeParse(snap.data());
          return parsed.success ? parsed.data : null;
        })()
      : null;
    this.historyCache.set(courseId, val);
    return val;
  }

  async getProfessorSummary(netid: string): Promise<ProfessorSummary | null> {
    if (!netid) return null;
    const cached = this.summaryCache.get(netid);
    if (cached !== undefined) return cached;
    const docData = await this.fetchProfessorDoc(netid);
    const summary = docData
      ? summaryFromDoc(docData as ProfessorReviewsDocLike, this.now())
      : null;
    this.summaryCache.set(netid, summary);
    return summary;
  }

  async getCourseView(courseId: string): Promise<CourseReviewView | null> {
    if (!courseId) return null;
    const history = await this.fetchHistoryDoc(courseId);
    if (!history) return null;
    // Collect the distinct netids across every term, resolve each to a
    // (staleness-filtered) summary via the per-netid cache, then let the pure
    // assembler join them into perProfessor + the timeline.
    const netids = new Set<string>();
    for (const term of history.terms) {
      for (const instr of term.instructors) netids.add(instr.netid);
    }
    const summaries = new Map<string, ProfessorSummary>();
    await Promise.all(
      [...netids].map(async (netid) => {
        const s = await this.getProfessorSummary(netid);
        if (s) summaries.set(netid, s);
      })
    );
    return courseViewFromDocs(history as CourseInstructorHistoryDocLike, summaries);
  }
}
