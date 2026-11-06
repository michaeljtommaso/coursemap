import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import type { CourseFilters } from "@/hooks/useCourseFilters";

/**
 * useCountsTowardParam (spec 025 D10) — the Requirements page's "Find a class"
 * opens /classes with "Counts toward" (spec 022) already set. The page links
 * to `/classes?countsToward=<requirement id>`; the Classes page applies it to
 * its filters once and drops the param, so clearing the filter sticks.
 */

export const COUNTS_TOWARD_PARAM = "countsToward";

/** The Classes page, filtered to classes that count toward `requirementId`. */
export function findClassUrl(requirementId: string): string {
  return `/classes?${COUNTS_TOWARD_PARAM}=${encodeURIComponent(requirementId)}`;
}

export function useCountsTowardParam(
  setFilters: Dispatch<SetStateAction<CourseFilters>>,
  /** The picker's options, to name the chip ("First-Year Writing Seminars"). */
  groups?: readonly { options: readonly { id: string; label: string }[] }[]
): void {
  const [params, setParams] = useSearchParams();
  const requirementId = params.get(COUNTS_TOWARD_PARAM);
  // Read at apply time only: the options can change identity every render.
  // (Updated in an effect declared first, so the apply effect below sees it.)
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  });
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!requirementId) {
      applied.current = null;
      return;
    }
    if (applied.current === requirementId) return;
    applied.current = requirementId;
    const label = groupsRef.current?.flatMap((g) => g.options).find((o) => o.id === requirementId)?.label;
    setFilters((f) => ({ ...f, requirementId, requirementLabel: label }));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(COUNTS_TOWARD_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [requirementId, setFilters, setParams]);
}
