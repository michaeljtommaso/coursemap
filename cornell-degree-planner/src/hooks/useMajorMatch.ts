import { useEffect, useMemo, useState } from "react";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { usePlan } from "@/hooks/usePlan";
import type { Program, ProgramSlotWithData } from "@/types/db";

/**
 * useMajorMatch (spec 005 §2, surfaced early for the Phase 3 Majors tab) —
 * the course-first loop's other half: given what the student has completed
 * and planned, how well does each major fit?
 *
 * Pool = courses the student has COMMITTED to: completed slots' courses +
 * user-placed selections. Template defaults don't count until completed —
 * otherwise every program would "match itself" at 100%.
 *
 * Score = matched required (kind='course') slots / total required slots.
 * All four program docs are prefetched lazily after first paint (cache-by-id
 * in ProgramProvider, so this costs at most 3 extra reads per session).
 */

export type MajorMatch = {
  program: Program;
  matched: number;
  required: number;
  pct: number;
  matchedCourses: { id: string; code: string; title: string }[];
  missing: { id: string; code: string; title: string }[];
};

export function useMajorMatch(currentSlots: ProgramSlotWithData[]): {
  matches: MajorMatch[];
  ready: boolean;
} {
  const { programs, loadProgramData, getProgramData } = useProgramContext();
  const { completedSlotIds, slotSelections, selectedCourses } = usePlan();
  const [loadedVersion, setLoadedVersion] = useState(0);

  // Idle prefetch of every program doc (cached — repeat calls are free).
  useEffect(() => {
    if (programs.length === 0) return;
    let cancelled = false;
    const run = () => {
      Promise.allSettled(programs.map((p) => loadProgramData(p.id))).then(() => {
        if (!cancelled) setLoadedVersion((v) => v + 1);
      });
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    const handle = hasIdle ? window.requestIdleCallback(run) : window.setTimeout(run, 600);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle);
    };
  }, [programs, loadProgramData]);

  // The student's committed course pool.
  const pool = useMemo(() => {
    const ids = new Set<string>();
    const completedSet = new Set(completedSlotIds);
    for (const slot of currentSlots) {
      const placedId = slotSelections[slot.id];
      if (placedId) {
        ids.add(placedId); // planned counts
        continue;
      }
      if (completedSet.has(slot.id) && slot.kind === "course" && slot.courses) {
        ids.add(slot.courses.id);
      }
    }
    // Completed elective/pattern slots with a placed course are covered above;
    // completed fixed slots without a selection use the template course.
    for (const slot of currentSlots) {
      if (!completedSet.has(slot.id)) continue;
      const placedId = slotSelections[slot.id];
      if (placedId) ids.add(placedId);
    }
    void selectedCourses;
    return ids;
  }, [currentSlots, completedSlotIds, slotSelections, selectedCourses]);

  const matches = useMemo(() => {
    const out: MajorMatch[] = [];
    for (const program of programs) {
      const data = getProgramData(program.id);
      if (!data) continue; // not loaded yet — reappears on loadedVersion bump
      const required = data.slots.filter((s) => s.kind === "course" && s.courses);
      const matchedCourses: MajorMatch["matchedCourses"] = [];
      const missing: MajorMatch["missing"] = [];
      for (const s of [...required].sort((a, b) => a.suggested_semester - b.suggested_semester)) {
        const c = s.courses!;
        const entry = { id: c.id, code: `${c.subject} ${c.number}`, title: c.title };
        if (pool.has(c.id)) matchedCourses.push(entry);
        else missing.push(entry);
      }
      // Dedup cross-listed duplicates within a program (same course id twice).
      const seen = new Set<string>();
      const m = matchedCourses.filter((e) => !seen.has(e.id) && seen.add(e.id));
      const seen2 = new Set<string>(m.map((e) => e.id));
      const miss = missing.filter((e) => !seen2.has(e.id) && seen2.add(e.id));
      const total = m.length + miss.length;
      out.push({
        program,
        matched: m.length,
        required: total,
        pct: total > 0 ? Math.round((m.length / total) * 100) : 0,
        matchedCourses: m,
        missing: miss,
      });
    }
    return out.sort((a, b) => b.pct - a.pct || a.program.name.localeCompare(b.program.name));
    // loadedVersion re-derives once all program docs land in the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, pool, getProgramData, loadedVersion]);

  return { matches, ready: matches.length === programs.length && programs.length > 0 };
}
