import { useState, useEffect, useMemo, useCallback } from "react";
import { useProgramContext } from "@/contexts/ProgramProvider";
import type { ProgramSlotWithData } from "@/types/db";

const CUSTOM_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];
const CUSTOM_ROWS = 5;

// Custom templates are a deferred feature (spec 000 §2 — parked, not deleted);
// their slots are synthetic and never hit Firestore. Preserved verbatim so the
// existing store path keeps working without a data layer.
function buildCustomTemplateSlots(programId: string): ProgramSlotWithData[] {
  const slots: ProgramSlotWithData[] = [];
  for (const sem of CUSTOM_SEMS) {
    for (let row = 0; row < CUSTOM_ROWS; row++) {
      slots.push({
        id: `${programId}-s${sem}-r${row}`,
        program_id: programId,
        kind: "elective",
        course_id: null,
        pattern: null,
        pattern_title: null,
        elective_group_id: null,
        suggested_semester: sem,
        slot_row: row,
        category: "elective",
        courses: null,
        elective_groups: {
          id: "__custom-generic__",
          program_id: null,
          name: "Any Course",
          description: null,
          qualifying_rule: { type: "open" },
          min_credits: 3,
          advisor_approval: false,
          notes: null,
        },
      });
    }
  }
  return slots;
}

/**
 * Thin hook over ProgramProvider. Returns { slots, loading, error, refetch }
 * (docs/specs/002 §5). Authored `edges` are dead (spec 008 §2b) — the canvas
 * derives its wires from placed courses' prereq/coreq trees now, so this hook
 * no longer surfaces an edges array. One program doc read (cached by the
 * provider) supplies the slots.
 */
type FetchResult = {
  key: string;
  /** null when the request failed (keep showing cached slots, if any). */
  slots: ProgramSlotWithData[] | null;
  error: string | null;
};

const NO_SLOTS: ProgramSlotWithData[] = [];

export function useProgramData(programId: string | null): {
  slots: ProgramSlotWithData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { getProgramData, loadProgramData } = useProgramContext();
  // The last fetch's result, tagged with the request it answers; everything
  // else (no program, custom template, cached data, loading) is derived.
  const [fetched, setFetched] = useState<FetchResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const customTemplateSlots = useMemo(
    () => (programId?.startsWith("custom-") ? buildCustomTemplateSlots(programId) : null),
    [programId]
  );

  // One request per (program, reload); none for no program or a custom template.
  const requestKey = programId && !customTemplateSlots ? `${programId}#${reloadKey}` : null;

  useEffect(() => {
    if (!requestKey || !programId) return;
    let cancelled = false;
    loadProgramData(programId)
      .then((data) => {
        if (cancelled) return;
        setFetched(
          data
            ? { key: requestKey, slots: data.slots, error: null }
            : { key: requestKey, slots: [], error: "Program not found. It may have been removed." }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setFetched({
          key: requestKey,
          slots: null,
          error: "Failed to load program data. Check your connection and try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, programId, loadProgramData]);

  if (!programId) return { slots: NO_SLOTS, loading: false, error: null, refetch };
  if (customTemplateSlots) return { slots: customTemplateSlots, loading: false, error: null, refetch };

  // Stale-while-revalidate: cached data paints immediately while the request runs.
  const current = fetched && fetched.key === requestKey ? fetched : null;
  const cached = getProgramData(programId);
  return {
    slots: current?.slots ?? cached?.slots ?? NO_SLOTS,
    loading: !current && !cached,
    error: current?.error ?? null,
    refetch,
  };
}
