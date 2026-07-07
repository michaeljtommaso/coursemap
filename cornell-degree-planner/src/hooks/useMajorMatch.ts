import { useEffect, useMemo, useState } from "react";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { patternToRegex } from "@/lib/planner/evaluatePrereq";
import type { Program, ProgramSlotWithData, QualifyingRule } from "@/types/db";

/**
 * useMajorMatch — FULLY BUILT per spec 005 §2b:
 *  - Pool = committed courses (completed slots' courses + user placements),
 *    canonicalized through catalog/meta aliases (ENGRD-2110 ≡ CS-2110).
 *  - Requirements = a program's course-kind slots AND its pattern slots
 *    (CS-111x is a requirement satisfied by any matching pool course).
 *  - Elective fit is a SECONDARY signal (never in the %): pool courses that
 *    qualify for the program's elective groups via id-computable rules
 *    (level / outside / open; list & category need data we don't ship client-side).
 *  - Consumers pass EFFECTIVE slots, so removed slots' contents don't count.
 */

export type MajorMatch = {
  program: Program;
  matched: number;
  required: number;
  pct: number;
  matchedCourses: { id: string; code: string; title: string }[];
  missing: { id: string; code: string; title: string }[];
  electiveFit: number;
};

function courseIdToCode(id: string): string {
  return id.replace(/-/g, " ");
}

function qualifies(rule: QualifyingRule, courseId: string): boolean {
  const [subject, numberStr] = courseId.split("-");
  const num = parseInt(numberStr ?? "", 10);
  switch (rule.type) {
    case "open":
      return true;
    case "level":
      return subject === rule.subject && !Number.isNaN(num) && num >= rule.min_number;
    case "outside":
      return !rule.exclude_subjects.includes(subject);
    case "list":
    case "category":
      return false; // needs server-side data — not part of the client signal
  }
}

export function useMajorMatch(currentSlots: ProgramSlotWithData[]): {
  matches: MajorMatch[];
  ready: boolean;
} {
  const { programs, loadProgramData, getProgramData } = useProgramContext();
  const { aliases } = useCatalogContext();
  const currentProgramId = useProgramStore((s) => s.selectedProgramId);
  const { completedSlotIds, waivedSlotIds, slotSelections, selectedCourses } = usePlan();
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

  // Canonicalize an id through the alias map (either direction).
  const canonical = useMemo(() => {
    return (id: string): string => aliases[id] ?? id;
  }, [aliases]);

  // The student's committed course pool, canonicalized.
  const pool = useMemo(() => {
    const ids = new Set<string>();
    const completedSet = new Set(completedSlotIds);
    for (const slot of currentSlots) {
      const placedId = slotSelections[slot.id];
      if (placedId) {
        ids.add(canonical(placedId)); // planned counts
        continue;
      }
      if (completedSet.has(slot.id) && slot.kind === "course" && slot.courses) {
        ids.add(canonical(slot.courses.id));
      }
    }
    void selectedCourses;
    return ids;
  }, [currentSlots, completedSlotIds, slotSelections, selectedCourses, canonical]);

  const poolCodes = useMemo(
    () => new Set([...pool].map(courseIdToCode)),
    [pool]
  );

  const matches = useMemo(() => {
    const out: MajorMatch[] = [];
    for (const program of programs) {
      const data = getProgramData(program.id);
      if (!data) continue; // not loaded yet — reappears on loadedVersion bump

      const matchedCourses: MajorMatch["matchedCourses"] = [];
      const missing: MajorMatch["missing"] = [];
      const seen = new Set<string>();
      const sorted = [...data.slots].sort(
        (a, b) => a.suggested_semester - b.suggested_semester
      );
      // For the student's OWN program, a slot completed/waived generically
      // (e.g. "my FWS is done, didn't record which") satisfies the requirement.
      // Other programs only get transferable evidence: actual pool courses.
      const isCurrent = program.id === currentProgramId;
      const doneSlots = isCurrent
        ? new Set([...completedSlotIds, ...waivedSlotIds])
        : null;

      for (const s of sorted) {
        const slotDone = doneSlots?.has(s.id) ?? false;
        if (s.kind === "course" && s.courses) {
          const cid = canonical(s.courses.id);
          if (seen.has(cid)) continue;
          seen.add(cid);
          const entry = {
            id: cid,
            code: `${s.courses.subject} ${s.courses.number}`,
            title: s.courses.title,
          };
          (pool.has(cid) || slotDone ? matchedCourses : missing).push(entry);
        } else if (s.kind === "pattern" && s.pattern) {
          const key = `pat:${s.pattern}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const re = patternToRegex(s.pattern);
          const hit = [...poolCodes].some((code) => re.test(code));
          const entry = {
            id: key,
            code: s.pattern.replace(/-/g, " "),
            title: s.pattern_title ?? "Any matching course",
          };
          (hit || slotDone ? matchedCourses : missing).push(entry);
        }
      }

      // Elective fit (secondary): pool courses qualifying for any of this
      // program's elective groups — id-computable rules only.
      const groups = new Map<string, QualifyingRule>();
      for (const s of data.slots) {
        if (s.kind === "elective" && s.elective_groups) {
          groups.set(s.elective_groups.id, s.elective_groups.qualifying_rule);
        }
      }
      let electiveFit = 0;
      for (const id of pool) {
        for (const rule of groups.values()) {
          if (qualifies(rule, id)) {
            electiveFit++;
            break;
          }
        }
      }

      const total = matchedCourses.length + missing.length;
      out.push({
        program,
        matched: matchedCourses.length,
        required: total,
        pct: total > 0 ? Math.round((matchedCourses.length / total) * 100) : 0,
        matchedCourses,
        missing,
        electiveFit,
      });
    }
    return out.sort(
      (a, b) => b.pct - a.pct || a.program.name.localeCompare(b.program.name)
    );
    // loadedVersion re-derives once all program docs land in the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, pool, poolCodes, canonical, getProgramData, loadedVersion,
      currentProgramId, completedSlotIds, waivedSlotIds]);

  return { matches, ready: matches.length === programs.length && programs.length > 0 };
}
