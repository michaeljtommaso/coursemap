// scripts/roster-convert.ts
// Pure converter: roster API row (ClassRow) → Firestore course-upsert shape
// (CourseUpsert). Extracted from roster-sync.ts (spec 010 §1/§3/§4, Unit 10A —
// crseAttrs + enrollGroups ingest) so it has NO IO/firebase imports and is
// corpus-testable — roster-sync.ts runs main() at module top level and can't be
// imported by tests; this module has no top-level execution, so
// scripts/roster-convert.corpus.ts can import it directly with `npx tsx`.
//
// Live-shape probe (spec 010 decision 2 — ONE live subject fetch, roster FA26,
// subject CS, 2026-07-11, read-only, no writes). Confirmed nesting for CS 2110:
//
//   enrollGroups[0] = {
//     classSections: [
//       { ssrComponent: "LEC", section: "001", classNbr: 17258,
//         meetings: [{ timeStart: "10:10AM", timeEnd: "11:25AM", pattern: "TR",
//                      instructors: [{ netid: "al123", firstName: "Ada",
//                                      lastName: "Lovelace" }] }],
//         openStatus: "O", instructionMode: "P", crseAttrs: [...] },
//       { ssrComponent: "DIS", section: "201", ... },
//       { ssrComponent: "DIS", section: "202", ... },
//     ],
//     unitsMinimum: 4, unitsMaximum: 4,
//     gradingBasis: "...", componentsRequired: [...], componentsOptional: [...],
//   }
//
// **Instructors live on `meetings[].instructors`, NOT directly on the
// classSection.** A section can have several meeting patterns (rare, but
// possible), each carrying its own instructor list — coded defensively per
// decision 2: union instructors across ALL of a section's meetings (dedupe by
// netid, see parseSections below), never assume a single meeting.
// gradingBasis/componentsRequired/componentsOptional are GROUP-level fields,
// not per-section — also confirmed by the probe.
//
// crseAttrs (course-level, e.g. `{ crseAttrValue: "SMR-AS", descr: "...",
// attrDescr: "Distribution Requirements" }`) was also confirmed populated and
// per-course in the same probe, matching debug doc Part 1.5.

import { z } from "zod";
import { parseForbiddenOverlaps } from "./forbidden-overlaps";

// Credits guard (spec §8g): plain JS numbers, 0 ≤ credits ≤ 20.
export const CreditSchema = z.number().min(0).max(20);

// Defensive caps (spec 010 §3) — a corrupt/huge roster row must never blow up
// the upsert or the Firestore doc size. Drops beyond these are counted in
// ConvertStats for the dry-run report; never silently unbounded.
const MAX_SECTIONS = 60;
const MAX_INSTRUCTORS_PER_SECTION = 10;
const MAX_MEETINGS_PER_SECTION = 10;

export type ClassRow = {
  subject: string;
  catalogNbr: string;
  titleLong: string;
  description?: string | null;
  lastTermsOffered?: string | null;
  crseId?: number | string;
  enrollGroups?: Array<{
    unitsMinimum?: number;
    unitsMaximum?: number;
    // Group-level fields (spec 010 §1/§2 — measured live, see file header).
    gradingBasis?: string;
    componentsRequired?: string[];
    componentsOptional?: string[];
    classSections?: Array<{
      ssrComponent?: string;
      section?: string;
      classNbr?: number;
      openStatus?: string;
      instructionMode?: string;
      meetings?: Array<{
        pattern?: string;
        timeStart?: string;
        timeEnd?: string;
        // Measured live: instructors nest under meetings, not the section.
        instructors?: Array<{ netid?: string; firstName?: string; lastName?: string }>;
      }>;
    }>;
  }>;
  // Distribution tags (spec 010 §1; debug doc Part 1.5) — populated per-course;
  // ENGL alone exposes 22 distinct values.
  crseAttrs?: Array<{ crseAttrValue?: string; descr?: string; attrDescr?: string }>;
  // Free-text prereq/coreq fields. Verified live (FA26, 2026-07-07): the real
  // prose lives in catalogPrereq/catalogCoreq; catalogPrereqCoreq is empty in
  // this roster but kept as a fallback so the capture is robust to future data.
  catalogPrereq?: string | null;
  catalogCoreq?: string | null;
  catalogPrereqCoreq?: string | null;
  // Credit-exclusion prose (spec 007 §5 / Unit 7D, debug doc #11): "Students may
  // not receive credit for both CS 1110 and CS 1112." Distinct from prereq/coreq
  // and from cross-listing — a transcript constraint, not a scheduling one.
  catalogForbiddenOverlaps?: string | null;
};

export type CourseAttrRow = { value: string; descr: string; group: string };

export type CourseSectionRow = {
  code: string; // `${ssrComponent} ${section}`, e.g. "LEC 001"
  component: string;
  openStatus: string | null;
  gradingBasis: string | null;
  components: string[]; // this section's group's componentsRequired, e.g. ["LEC","DIS"]
  instructors: Array<{ netid: string; firstName: string; lastName: string }>;
  meetings: Array<{ pattern: string; timeStart: string; timeEnd: string }>;
};

export type CourseUpsert = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  description: string | null;
  offered: string[];
  // ⚠️ NAMING TRAP (spec-002-era accident, root-caused 2026-07-11): despite the
  // name, rosterId is Cornell's NUMERIC crseId ("358546") — it is NOT the roster
  // slug. Never compare it to a slug like "FA26". Kept exactly as-is because
  // other consumers may rely on the historical value.
  rosterId: string | null;
  // The actual roster SLUG the sync ran against ("FA26") — the field the app's
  // time-horizon gates compare against catalog/meta.enrollmentTarget (spec 012
  // §1 / near-face fix). ALWAYS written; threaded from roster-sync's resolved
  // ROSTER. This, not rosterId, answers "is this course offered this term?".
  roster: string;
  // Raw catalog prereq/coreq text, captured verbatim for the parse-prereqs
  // pipeline. null when the field is absent/blank. prereqExpr/coreqExpr are NOT
  // written here — merge preserves any hand-authored trees.
  prereqText: string | null;
  coreqText: string | null;
  // Parsed course-id list from catalogForbiddenOverlaps, self-stripped (spec 007
  // §5). ALWAYS written (never omitted) — string[] when parsed, null when
  // absent/unparseable — so merge-upserts overwrite stale values cleanly, same
  // convention as prereqText/coreqText.
  forbiddenOverlaps: string[] | null;
  // Spec 010 §1/§3 (Unit 10A) additions — ALWAYS written, null when absent, same
  // merge-overwrite convention as forbiddenOverlaps/prereqText.
  attrs: CourseAttrRow[] | null;
  sections: CourseSectionRow[] | null;
  components: string[] | null;
};

// Cap-drop counters for the dry-run report (spec 010 §4). Pass ONE shared
// instance across a whole sync run so rowToCourse can mutate it in place as it
// hits caps; a caller that doesn't care can omit it and gets a private
// throwaway (no visible effect, still capped correctly).
export type ConvertStats = {
  sectionCapDrops: number;
  instructorCapDrops: number;
  meetingCapDrops: number;
};
export function newConvertStats(): ConvertStats {
  return { sectionCapDrops: 0, instructorCapDrops: 0, meetingCapDrops: 0 };
}

export function parseOffered(lastTermsOffered: string | null | undefined): string[] {
  if (!lastTermsOffered) return [];
  const seen = new Set<string>();
  for (const term of lastTermsOffered.split(",")) {
    const t = term.trim();
    if (t.endsWith("FA")) seen.add("FA");
    else if (t.endsWith("SP")) seen.add("SP");
    else if (t.endsWith("SU")) seen.add("SU");
    else if (t.endsWith("WI")) seen.add("WI");
  }
  return [...seen];
}

// crseAttrs → deduped attrs list (spec 010 §3). Entries missing crseAttrValue
// are skipped — never invent a value. Deduped by value (first occurrence wins).
function parseAttrs(crseAttrs: ClassRow["crseAttrs"]): CourseAttrRow[] | null {
  if (!Array.isArray(crseAttrs) || crseAttrs.length === 0) return null;
  const seen = new Set<string>();
  const out: CourseAttrRow[] = [];
  for (const a of crseAttrs) {
    const value = a?.crseAttrValue;
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      descr: typeof a?.descr === "string" ? a.descr : "",
      group: typeof a?.attrDescr === "string" ? a.attrDescr : "",
    });
  }
  return out.length > 0 ? out : null;
}

// componentsRequired from the FIRST enroll group — course-level workload
// signal (spec 010 §3), e.g. ["LEC","DIS"] means "this class also requires a
// discussion section."
function parseComponents(enrollGroups: ClassRow["enrollGroups"]): string[] | null {
  const first = Array.isArray(enrollGroups) ? enrollGroups[0] : undefined;
  const raw = first?.componentsRequired;
  if (!Array.isArray(raw)) return null;
  const cleaned = raw.filter((s): s is string => typeof s === "string" && s.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

// classSections across ALL enrollGroups → one CourseSectionRow each (spec 010
// §3). Instructors are unioned from meetings[].instructors (measured live, see
// file header) and deduped by netid; missing netid falls back to a
// "name:First Last" dedupe key but the stored instructor keeps netid "" — never
// invent one. Meetings are kept only when pattern AND both times are present.
// Capped defensively (60 sections/course, 10 instructors/section,
// 10 meetings/section); drops beyond the cap increment `stats` for the
// dry-run report rather than growing the doc unbounded.
function parseSections(
  enrollGroups: ClassRow["enrollGroups"],
  stats: ConvertStats
): CourseSectionRow[] | null {
  if (!Array.isArray(enrollGroups) || enrollGroups.length === 0) return null;
  const sections: CourseSectionRow[] = [];

  for (const eg of enrollGroups) {
    const gradingBasis =
      typeof eg.gradingBasis === "string" && eg.gradingBasis.length > 0
        ? eg.gradingBasis
        : null;
    const groupComponents = Array.isArray(eg.componentsRequired)
      ? eg.componentsRequired.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    const classSections = Array.isArray(eg.classSections) ? eg.classSections : [];

    for (const cs of classSections) {
      if (sections.length >= MAX_SECTIONS) {
        stats.sectionCapDrops++;
        continue;
      }
      const component = typeof cs.ssrComponent === "string" ? cs.ssrComponent : "";
      const sectionNum = typeof cs.section === "string" ? cs.section : "";
      const code = `${component} ${sectionNum}`.trim();
      const openStatus =
        typeof cs.openStatus === "string" && cs.openStatus.length > 0 ? cs.openStatus : null;

      const instructorMap = new Map<
        string,
        { netid: string; firstName: string; lastName: string }
      >();
      const meetings: Array<{ pattern: string; timeStart: string; timeEnd: string }> = [];
      const meetingsRaw = Array.isArray(cs.meetings) ? cs.meetings : [];

      for (const m of meetingsRaw) {
        for (const instr of Array.isArray(m.instructors) ? m.instructors : []) {
          const netid = typeof instr.netid === "string" ? instr.netid : "";
          const firstName = typeof instr.firstName === "string" ? instr.firstName : "";
          const lastName = typeof instr.lastName === "string" ? instr.lastName : "";
          const key = netid.length > 0 ? `netid:${netid}` : `name:${firstName} ${lastName}`;
          if (instructorMap.has(key)) continue; // dedupe — not a cap drop
          if (instructorMap.size >= MAX_INSTRUCTORS_PER_SECTION) {
            stats.instructorCapDrops++;
            continue;
          }
          instructorMap.set(key, { netid, firstName, lastName });
        }
        if (
          typeof m.pattern === "string" && m.pattern.length > 0 &&
          typeof m.timeStart === "string" && m.timeStart.length > 0 &&
          typeof m.timeEnd === "string" && m.timeEnd.length > 0
        ) {
          if (meetings.length >= MAX_MEETINGS_PER_SECTION) {
            stats.meetingCapDrops++;
            continue;
          }
          meetings.push({ pattern: m.pattern, timeStart: m.timeStart, timeEnd: m.timeEnd });
        }
      }

      sections.push({
        code,
        component,
        openStatus,
        gradingBasis,
        components: groupComponents,
        instructors: [...instructorMap.values()],
        meetings,
      });
    }
  }

  return sections.length > 0 ? sections : null;
}

export function rowToCourse(
  c: ClassRow,
  // The roster SLUG this row was fetched from ("FA26") — required so `roster`
  // is ALWAYS written (the type makes forgetting it a compile error).
  roster: string,
  stats: ConvertStats = newConvertStats()
): CourseUpsert | null {
  const rawMin = c.enrollGroups?.[0]?.unitsMinimum;
  const rawMax = c.enrollGroups?.[0]?.unitsMaximum;
  // Skip rows without parseable credits rather than write garbage.
  if (typeof rawMin !== "number" || typeof rawMax !== "number") return null;
  const min = CreditSchema.safeParse(rawMin);
  const max = CreditSchema.safeParse(rawMax);
  if (!min.success || !max.success) {
    console.warn(`  skip ${c.subject}-${c.catalogNbr}: credits out of range (${rawMin}/${rawMax})`);
    return null;
  }
  // Capture raw prereq/coreq prose. Prefer the split fields (populated on FA26);
  // fall back to the combined catalogPrereqCoreq field if a future roster uses it.
  const clean = (s: string | null | undefined): string | null => {
    if (typeof s !== "string") return null;
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 0 ? t : null;
  };
  const prereqText = clean(c.catalogPrereq) ?? clean(c.catalogPrereqCoreq);
  const coreqText = clean(c.catalogCoreq);
  const id = `${c.subject}-${c.catalogNbr}`;
  const forbiddenOverlaps = parseForbiddenOverlaps(c.catalogForbiddenOverlaps, id);
  return {
    id,
    subject: c.subject,
    number: c.catalogNbr,
    title: c.titleLong,
    creditsMin: rawMin,
    creditsMax: rawMax,
    description: c.description ?? null,
    offered: parseOffered(c.lastTermsOffered ?? null),
    // ⚠️ rosterId = numeric crseId (naming trap — see CourseUpsert). The slug
    // lives in `roster` below.
    rosterId: c.crseId != null ? String(c.crseId) : null,
    roster,
    prereqText,
    coreqText,
    forbiddenOverlaps,
    attrs: parseAttrs(c.crseAttrs),
    sections: parseSections(c.enrollGroups, stats),
    components: parseComponents(c.enrollGroups),
  };
}
