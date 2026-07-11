/**
 * sections.ts (spec 012 §2/§4) — pure display + parsing helpers for a course's
 * per-roster `sections` (instructor / meeting / open-status / grading data).
 * Used by the near-horizon card face, the detail panel's Sections block, and
 * conflicts.ts (which shares the day/time parsers). No React here.
 */

import type { CourseSection } from "@/types/db";

/**
 * The section a near-horizon card speaks for (spec 012 §4, recorded v1
 * decision): the first LEC component, else the first section of any kind. null
 * when the course carries no sections (future rosters, un-synced courses).
 */
export function primarySection(sections: CourseSection[]): CourseSection | null {
  if (!sections || sections.length === 0) return null;
  return sections.find((s) => s.component === "LEC") ?? sections[0];
}

/** Deduped "First Last" instructor names for a section (quiet single line). */
export function sectionInstructorNames(section: CourseSection): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of section.instructors) {
    const name = `${i.firstName} ${i.lastName}`.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Tokenize a Cornell meeting pattern into day tokens. "Su" (Sunday) is checked
 * BEFORE "S" (Saturday); "R" is Thursday (Cornell convention). Case-insensitive;
 * unknown characters (separators) are skipped silently. "TR" → ["T","R"],
 * "MWF" → ["M","W","F"], "SuS" → ["Su","S"].
 */
export function parseDayTokens(pattern: string): string[] {
  const out: string[] = [];
  const p = (pattern ?? "").trim();
  let i = 0;
  while (i < p.length) {
    // Su before S — Sunday must not be mis-read as Saturday + stray "u".
    if ((p[i] === "S" || p[i] === "s") && (p[i + 1] === "u" || p[i + 1] === "U")) {
      out.push("Su");
      i += 2;
      continue;
    }
    const ch = p[i].toUpperCase();
    if ("MTWRFS".includes(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** "10:10AM" → minutes since midnight, or null when unparseable. */
export function parseClockToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec((t ?? "").trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 12 || min > 59) return null;
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}

/** minutes → "10:10" 12-hour clock, no meridian (the compact card-chip idiom). */
export function formatClock(min: number): string {
  let h = Math.floor(min / 60);
  const m = min % 60;
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "TR 10:10–11:25" from a section's first well-formed meeting, or null when
 *  the section has no meeting with both a day pattern and parseable times. */
export function formatMeetingChip(section: CourseSection): string | null {
  for (const mtg of section.meetings) {
    const days = parseDayTokens(mtg.pattern);
    const start = parseClockToMinutes(mtg.timeStart);
    const end = parseClockToMinutes(mtg.timeEnd);
    if (days.length === 0 || start == null || end == null) continue;
    return `${days.join("")} ${formatClock(start)}–${formatClock(end)}`;
  }
  return null;
}

export type OpenStatusKind = "open" | "waitlist" | "closed";

/**
 * Map a roster openStatus token to a card dot state: O→open, W→waitlist,
 * C→closed. Anything else (or absent) → null (no dot, no false claim).
 */
export function openStatusKind(status: string | null | undefined): OpenStatusKind | null {
  if (!status) return null;
  const c = status.trim().toUpperCase()[0];
  if (c === "O") return "open";
  if (c === "W") return "waitlist";
  if (c === "C") return "closed";
  return null;
}

const OPEN_STATUS_WORD: Record<OpenStatusKind, string> = {
  open: "Open",
  waitlist: "Waitlist",
  closed: "Closed",
};
export function openStatusWord(status: string | null | undefined): string | null {
  const k = openStatusKind(status);
  return k ? OPEN_STATUS_WORD[k] : null;
}

/**
 * Whether a section's gradingBasis signals S/U (satisfactory/unsatisfactory) is
 * available. Cornell codes: "OPT"/"OPI" = student option (letter OR S/U),
 * "SUS" = S/U only. Keyed on those tokens; "GRD" (graded only) and unknowns
 * return false. (The token we key on is the OP* / SUS prefix — commented so a
 * future roster code shift is easy to find.)
 */
export function gradingBasisAllowsSU(gradingBasis: string | null | undefined): boolean {
  if (!gradingBasis) return false;
  const g = gradingBasis.trim().toUpperCase();
  return g.startsWith("OP") || g === "SUS" || g.includes("S/U");
}

const COMPONENT_NOUNS: Record<string, string> = {
  DIS: "discussion section",
  LAB: "lab",
  SEM: "seminar",
  REC: "recitation",
  STU: "studio",
  FLD: "field work",
};

/**
 * "also requires a discussion section" style note from a section's `components`
 * (the co-requisite components beyond the primary lecture). null when the
 * section requires nothing beyond a lecture / has no recognized extra.
 */
export function componentNote(components: string[]): string | null {
  const extras = (components ?? [])
    .filter((c) => c && c.toUpperCase() !== "LEC")
    .map((c) => COMPONENT_NOUNS[c.toUpperCase()] ?? null)
    .filter((n): n is string => n !== null);
  const unique = [...new Set(extras)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return `also requires a ${unique[0]}`;
  const last = unique[unique.length - 1];
  return `also requires a ${unique.slice(0, -1).join(", ")} and ${last}`;
}
