import type {
  ReviewsProvider,
  ProfessorSummary,
  CourseReviewView,
} from "./types";

/**
 * NullAdapter (spec 013 §3a/§4) — the wired default and the kill switch. It
 * returns null for EVERYTHING, so every professor surface renders its honest
 * empty state and no professor UI appears anywhere. Swapping the real
 * RmpAdapter in (next unit) must require zero component changes — the
 * NullAdapter smoke test guards that contract.
 */
export class NullAdapter implements ReviewsProvider {
  async getProfessorSummary(_netid: string): Promise<ProfessorSummary | null> {
    return null;
  }
  async getCourseView(_courseId: string): Promise<CourseReviewView | null> {
    return null;
  }
}
