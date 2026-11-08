/**
 * limitScope.ts — which of a credit's limit lines and note a student should
 * see. Cornell's exam tables write some lines for particular majors
 * ("Biological Sciences majors: elective credit only", "Biomedical
 * Engineering majors need a 5") and pair them with a line for everyone else
 * ("Other majors: places you out of 8 credits"). Shown to every student, a
 * line for another major reads as if it applied to them. Pure.
 */

/** The student's major, as the program index names it. */
export type MajorRef = { name: string; shortName?: string };

/** Abbreviations the tables use that differ from a program's short name. */
const ABBREVIATION_ALIASES: Record<string, string[]> = {
  // Cornell's Biological and Environmental Engineering department.
  bee: ["be"],
};

const OTHER_MAJORS = /^other majors:\s*/i;

/** The words naming the majors a line is written for ("Biological Sciences
 *  and Urban and Regional Studies"), or null for a line for everyone. */
export function majorScope(text: string): string | null {
  if (OTHER_MAJORS.test(text)) return null;
  const m = /^(?:not for\s+)?(.+?)\s+majors\b/i.exec(text);
  // A scope is a run of names; punctuation means "majors" came mid-sentence
  // in a line written for everyone.
  return m && !/[:;.!?]/.test(m[1]) ? m[1] : null;
}

/** "Biological Sciences, B.A." → "biological sciences". */
function baseName(name: string): string {
  return name.split(",")[0].trim().toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does a scope ("CALS Biological and Environmental Engineering (BEE)") name
 *  this major, by full name or by an abbreviation in parentheses? */
export function scopeNamesMajor(scope: string, major: MajorRef): boolean {
  const lower = scope.toLowerCase();
  const name = baseName(major.name);
  if (name && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(lower)) return true;
  const short = major.shortName?.trim().toLowerCase();
  if (!short) return false;
  for (const group of lower.matchAll(/\(([^)]+)\)/g)) {
    for (const abbr of group[1].split("/").map((s) => s.trim())) {
      if (abbr === short || ABBREVIATION_ALIASES[abbr]?.includes(short)) return true;
    }
  }
  return false;
}

/** "Engineering hasn't set which requirement this fills": moot once the
 *  planner has placed the credit in a requirement. */
const UNSET_REQUIREMENT = /hasn['’]t set which requirement this fills/i;

/**
 * The limit lines and note to show for one credit.
 *  - A line for named majors shows only to those majors. With no major known
 *    (no program picked yet), every line shows.
 *  - An "Other majors:" note shows to everyone the credit's major-specific
 *    lines don't name, without its "Other majors:" lead-in once a major is
 *    known.
 *  - The "hasn't set which requirement this fills" line hides once `filled`
 *    names a requirement it counts toward.
 */
export function visibleCreditText(
  credit: { limits: readonly string[]; note?: string },
  major: MajorRef | null,
  filled?: readonly string[]
): { limits: string[]; note?: string } {
  const applies = (text: string): boolean => {
    const scope = majorScope(text);
    return scope === null || major === null || scopeNamesMajor(scope, major);
  };
  const namesThisMajor =
    major !== null &&
    [...credit.limits, credit.note ?? ""].some((t) => {
      const scope = majorScope(t);
      return scope !== null && scopeNamesMajor(scope, major);
    });

  const limits = credit.limits.filter(
    (l) => applies(l) && !(filled && filled.length > 0 && UNSET_REQUIREMENT.test(l))
  );

  let note = credit.note;
  if (note !== undefined) {
    if (OTHER_MAJORS.test(note)) {
      if (namesThisMajor) note = undefined;
      else if (major !== null) {
        const rest = note.replace(OTHER_MAJORS, "");
        note = rest.charAt(0).toUpperCase() + rest.slice(1);
      }
    } else if (!applies(note)) note = undefined;
  }
  return note !== undefined && note !== "" ? { limits, note } : { limits };
}
