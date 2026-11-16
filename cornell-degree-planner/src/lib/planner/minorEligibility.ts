import type { MinorIndexEntry } from "@/lib/schemas";
import type { Program } from "@/types/db";
import { matchesProgramPrefix } from "./distribution/overlap";
import { collegeShortName, programCollegeId, programIsVisible } from "./colleges";

/**
 * minorEligibility.ts (spec 047 D12) — whether a minor is open to the majors
 * on a plan, from its minor-index entry. Pure; every reader (the add flow,
 * the plan-load guard, the picker, the warnings, Minor Match) asks here so
 * they can't disagree.
 *
 * Two fields, matched like the `program` rule leaf (a prefix matches every
 * catalog year):
 *  - `notOpenTo`: closed when ANY major on the plan matches;
 *  - `onlyOpenTo`: closed unless SOME major on the plan matches.
 * "Majors on the plan" is the primary and the second major alike, in both
 * fields: a second major closes a `notOpenTo` minor exactly as the primary
 * does, so it opens an `onlyOpenTo` one exactly as the primary does. A plan
 * with no major yet has nothing to judge: never closed. `notOpenTo` is
 * checked first.
 */

export type MinorOpenness = {
  notOpenTo?: MinorIndexEntry["notOpenTo"] | readonly string[];
  onlyOpenTo?: MinorIndexEntry["onlyOpenTo"] | readonly string[];
};

export type MinorClosure =
  /** A major on the plan the minor isn't open to. */
  | { kind: "notOpenTo"; majorId: string }
  /** No major on the plan is one of the minor's `onlyOpenTo`. */
  | { kind: "onlyOpenTo"; onlyOpenTo: readonly string[] };

/** Why `entry`'s minor is closed to a plan with `majors`, or null when open
 *  (or unknown: no entry). */
export function minorClosure(
  entry: MinorOpenness | null | undefined,
  majors: readonly (string | null | undefined)[]
): MinorClosure | null {
  if (!entry) return null;
  const ids = majors.filter((m): m is string => !!m);
  const closedTo = ids.find((m) => matchesProgramPrefix(m, entry.notOpenTo));
  if (closedTo) return { kind: "notOpenTo", majorId: closedTo };
  const only = entry.onlyOpenTo;
  if (only && only.length > 0 && ids.length > 0 && !ids.some((m) => matchesProgramPrefix(m, only))) {
    return { kind: "onlyOpenTo", onlyOpenTo: only };
  }
  return null;
}

type ProgramLike = Pick<Program, "id" | "short_name" | "college" | "collegeId" | "status">;

function listed(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  const more = names.length - 2;
  return `${names[0]}, ${names[1]}, and ${more} other`;
}

/**
 * Who an `onlyOpenTo` minor is for, in plain words from the program list:
 * "Engineering majors" when the prefixes cover every visible major of one
 * college, else the matching majors' short names ("Nutritional Sciences
 * majors", "Biology and Chemistry majors", "A, B, and 3 other majors");
 * "certain majors" while the program list doesn't name any of them.
 */
export function onlyOpenToWho(prefixes: readonly string[], programs: readonly ProgramLike[]): string {
  const matched = programs.filter((p) => matchesProgramPrefix(p.id, prefixes));
  if (matched.length === 0) return "certain majors";
  const visible = matched.filter(programIsVisible);
  const shown = visible.length > 0 ? visible : matched;
  const colleges = new Set(shown.map((p) => programCollegeId(p)));
  if (colleges.size === 1) {
    const college = [...colleges][0];
    if (college) {
      const ofCollege = programs.filter((p) => programIsVisible(p) && programCollegeId(p) === college);
      if (ofCollege.length > 1 && ofCollege.every((p) => matchesProgramPrefix(p.id, prefixes))) {
        return `${collegeShortName(college)} majors`;
      }
    }
  }
  const names = [...new Set(shown.map((p) => p.short_name))].sort((a, b) => a.localeCompare(b));
  return `${listed(names)} majors`;
}
