/**
 * reviews/types.ts (spec 013 §3a) — the ReviewsProvider SEAM. App code imports
 * ONLY this interface; the concrete provider is chosen by config (index.ts).
 * The NullAdapter is the wired default and the kill switch: every professor
 * surface must render as if §3 never shipped when it's active, with zero
 * component changes required to swap it (enforced by a smoke test).
 *
 * ASYNC by design: both reads return a Promise even though today's adapters
 * resolve synchronously (NullAdapter → null; a future RmpAdapter → a preloaded
 * Firestore-backed lookup). Committing to Promise now means the RmpAdapter can
 * land next unit as a config-only swap without changing a single call site's
 * await shape. Match confidence + snippet fields mirror spec §3a/§3c EXACTLY.
 */

/** Per-professor rollup, keyed by roster netid (spec §3a/§3c). */
export type ProfessorSummary = {
  /** RMP overall rating (0–5), or null when RMP has a page but no rating. */
  rating: number | null;
  /** RMP difficulty (0–5), the "difficulty" half of difficulty×interest. */
  difficulty: number | null;
  /** Number of ratings behind the summary (sample size). */
  count: number;
  /** Match tier (spec §3c). "verified" = unique exact match; "probable" = fuzzy
   *  best candidate, shown with an explicit "double-check" hedge. "none" is
   *  represented by the whole summary being null — never by this field. */
  confidence: "verified" | "probable";
  /** Deep link to the professor's RMP page ("via RateMyProfessors ↗"). */
  url: string;
  /** First ~150 chars of the top review (spec §3e guardrail 1/2) — its OWN
   *  optional field so it can be dropped independently of the ratings. */
  topSnippet?: string;
};

/** One instructor's rating within a course's per-professor breakdown. */
export type CourseProfessorEntry = {
  /** Display "First Last". */
  instructor: string;
  netid: string;
  rating: number | null;
  difficulty: number | null;
  url: string;
  /** Match tier for THIS instructor's summary (spec §3c) — carried on the join
   *  (Unit 13B) so a course cell renders the verified/probable hedge without a
   *  second per-netid lookup. Optional + additive: absent under the NullAdapter
   *  (which returns null wholesale) and on any pre-13B assembler. */
  confidence?: "verified" | "probable";
  /** Sample size behind this instructor's rating — needed by the divergence
   *  (varies-by-instructor) math's min-N gate. Optional + additive. */
  count?: number | null;
  /** First ≤160 chars of the top review (spec §3e guardrail 1/2) — its OWN
   *  optional field so a surface can drop it independently of the rating. */
  topSnippet?: string;
};

/** A term in a course's instructor-history timeline (spec §3d). */
export type CourseHistoryEntry = {
  /** Roster slug the entry is for ("FA25"). */
  term: string;
  instructor: string;
  netid: string;
  rating: number | null;
  url: string;
};

/** Per-course review view: the professor breakdown + the history timeline. */
export type CourseReviewView = {
  perProfessor: CourseProfessorEntry[];
  history: CourseHistoryEntry[];
};

/**
 * The provider contract. Implementations: NullAdapter (wired default / kill
 * switch), RmpAdapter (next unit), future OfficialEvals / CUReviews.
 */
export interface ReviewsProvider {
  /** Summary for one instructor by netid, or null when there's no match/data. */
  getProfessorSummary(netid: string): Promise<ProfessorSummary | null>;
  /** Per-course review view, or null when there's nothing for the course. */
  getCourseView(courseId: string): Promise<CourseReviewView | null>;
}
