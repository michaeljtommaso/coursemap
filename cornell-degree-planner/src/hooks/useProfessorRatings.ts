import { useEffect, useState } from "react";
import { FEATURES } from "@/config/features";
import { EMPTY_RATINGS, type ProfessorRatingsMap } from "@/lib/classes/professorRatings";
import { loadProfessorRatings, peekProfessorRatings } from "@/services/professorRatings";

/**
 * useProfessorRatings (spec 017 D5) — the per-netid rating map for /classes
 * rows and the well-rated chip. One shared read per page load (see
 * services/professorRatings). `ready` turns true once the read settles; with
 * the ratings feature off it is an empty map from the start and nothing is read.
 */
export function useProfessorRatings(): { ratings: ProfessorRatingsMap; ready: boolean } {
  const enabled = FEATURES.rateMyProfessor;
  const [ratings, setRatings] = useState<ProfessorRatingsMap | null>(() =>
    enabled ? peekProfessorRatings() : EMPTY_RATINGS
  );

  useEffect(() => {
    if (!enabled || ratings) return;
    let alive = true;
    loadProfessorRatings(enabled).then((map) => {
      if (alive) setRatings(map);
    });
    return () => {
      alive = false;
    };
  }, [enabled, ratings]);

  return { ratings: ratings ?? EMPTY_RATINGS, ready: ratings !== null };
}
