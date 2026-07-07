import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchProgramSlots, fetchSlotEdges } from "@/lib/db/programs";
import type { ProgramSlotWithData, SlotEdge } from "@/types/db";

const CUSTOM_SEMS = [1, 2, 3, 4, 5, 6, 7, 8];
const CUSTOM_ROWS = 5;

function buildCustomSlots(programId: string): ProgramSlotWithData[] {
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
        courses: null,
        elective_groups: {
          // Synthetic group — never looked up in Supabase; display-only
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

export function useProgramData(programId: string | null) {
  const [slots, setSlots] = useState<ProgramSlotWithData[]>([]);
  const [edges, setEdges] = useState<SlotEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump to re-run the fetch effect (Retry button — spec 003 §5.2).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const customSlots = useMemo(
    () => (programId?.startsWith("custom-") ? buildCustomSlots(programId) : null),
    [programId]
  );

  useEffect(() => {
    if (!programId) {
      setSlots([]);
      setEdges([]);
      setError(null);
      return;
    }

    if (customSlots) {
      setSlots(customSlots);
      setEdges([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([fetchProgramSlots(programId), fetchSlotEdges(programId)])
      .then(([s, e]) => {
        setSlots(s);
        setEdges(e);
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to load program data. Check your connection and try again.");
      })
      .finally(() => setLoading(false));
  }, [programId, customSlots, reloadKey]);

  return { slots, edges, loading, error, refetch };
}
