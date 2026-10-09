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
export function useProgramData(programId: string | null): {
  slots: ProgramSlotWithData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { getProgramData, loadProgramData } = useProgramContext();
  const [slots, setSlots] = useState<ProgramSlotWithData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const customTemplateSlots = useMemo(
    () => (programId?.startsWith("custom-") ? buildCustomTemplateSlots(programId) : null),
    [programId]
  );

  useEffect(() => {
    if (!programId) {
      setSlots([]);
      setError(null);
      return;
    }

    if (customTemplateSlots) {
      setSlots(customTemplateSlots);
      setError(null);
      return;
    }

    let cancelled = false;

    // Stale-while-revalidate: paint cached data immediately, still (re)load.
    const cached = getProgramData(programId);
    if (cached) {
      setSlots(cached.slots);
      setError(null);
    }

    setLoading(!cached);
    setError(null);
    loadProgramData(programId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError("Program not found. It may have been removed.");
          setSlots([]);
          return;
        }
        setSlots(data.slots);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError("Failed to load program data. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [programId, customTemplateSlots, reloadKey, getProgramData, loadProgramData]);

  return { slots, loading, error, refetch };
}
