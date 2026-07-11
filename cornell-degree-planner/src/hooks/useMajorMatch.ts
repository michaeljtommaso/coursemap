import { useEffect, useMemo, useState } from "react";
import { useProgramContext } from "@/contexts/ProgramProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { courseSatisfiesRequirement } from "@/lib/planner/satisfies";
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

  // The student's committed course pool, canonicalized. Keyed by canonical id;
  // the value keeps the full course object WHERE AVAILABLE (placed picks carry a
  // full Course; a completed template slot carries its snapshot) so attribute
  // requirements (spec 010 §2) can test against title/attrs. Courses known only
  // by id (none today, but the shape tolerates it) pass what they have.
  const poolCourses = useMemo(() => {
    const map = new Map<string, { id: string; title?: string; attrs?: { value: string }[] }>();
    const completedSet = new Set(completedSlotIds);
    for (const slot of currentSlots) {
      const placedId = slotSelections[slot.id];
      if (placedId) {
        const cid = canonical(placedId); // planned counts
        const c = selectedCourses[placedId];
        if (!map.has(cid)) map.set(cid, { id: cid, title: c?.title, attrs: c?.attrs });
        continue;
      }
      if (completedSet.has(slot.id) && slot.kind === "course" && slot.courses) {
        const cid = canonical(slot.courses.id);
        if (!map.has(cid))
          map.set(cid, { id: cid, title: slot.courses.title, attrs: slot.courses.attrs });
      }
    }
    return map;
  }, [currentSlots, completedSlotIds, slotSelections, selectedCourses, canonical]);

  // Id-only view of the pool (elective-fit iterates ids; unchanged semantics).
  const pool = useMemo(() => new Set(poolCourses.keys()), [poolCourses]);

  // Course refs for the shared courseSatisfiesRequirement matcher. subject/number
  // are split from the canonical code on the FIRST space, so `${subject} ${number}`
  // reconstructs the code exactly — keeping the pattern test bit-identical to the
  // old `poolCodes.some(re.test)`. title/attrs ride along for attribute matching.
  const poolRefs = useMemo(
    () =>
      [...poolCourses.values()].map((c) => {
        const code = courseIdToCode(c.id);
        const sp = code.indexOf(" ");
        return {
          id: c.id,
          subject: sp >= 0 ? code.slice(0, sp) : code,
          number: sp >= 0 ? code.slice(sp + 1) : "",
          title: c.title,
          attrs: c.attrs,
        };
      }),
    [poolCourses]
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
          const req = { kind: "course" as const, courseId: s.courses.id };
          const hit = poolRefs.some((ref) =>
            courseSatisfiesRequirement(ref, req, canonical)
          );
          (hit || slotDone ? matchedCourses : missing).push(entry);
        } else if (s.kind === "pattern" && s.pattern) {
          const key = `pat:${s.pattern}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const req = { kind: "pattern" as const, pattern: s.pattern };
          const hit = poolRefs.some((ref) => courseSatisfiesRequirement(ref, req));
          const entry = {
            id: key,
            code: s.pattern.replace(/-/g, " "),
            title: s.pattern_title ?? "Any matching course",
          };
          (hit || slotDone ? matchedCourses : missing).push(entry);
        } else if (s.kind === "attribute" && s.attribute_match) {
          // Attribute requirement (spec 010 §2) — satisfied by any pool course
          // whose title/attrs match. Deduped by the match SIGNATURE, so the two
          // FWS slots (sem 1 + sem 2) collapse to one requirement exactly as the
          // old shared writing-seminar pattern key did (spec 011 revisits
          // requirement multiplicity).
          const key = `attr:${JSON.stringify(s.attribute_match)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const req = { kind: "attribute" as const, match: s.attribute_match };
          const hit = poolRefs.some((ref) =>
            courseSatisfiesRequirement(ref, req, canonical)
          );
          const entry = {
            id: key,
            code: s.pattern_title ?? "Requirement",
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
  }, [programs, pool, poolRefs, canonical, getProgramData, loadedVersion,
      currentProgramId, completedSlotIds, waivedSlotIds]);

  return { matches, ready: matches.length === programs.length && programs.length > 0 };
}
