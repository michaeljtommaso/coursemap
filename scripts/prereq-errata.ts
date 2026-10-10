// scripts/prereq-errata.ts
// Prose errata: reviewed find-and-replace corrections to Cornell's prerequisite
// prose, applied BEFORE prereq-grammar.ts parses it. Corrections are never
// stored trees: the parser still owns every tree.
//
// Each entry targets one course's prereqText or coreqText and names an exact
// substring of today's prose. When Cornell fixes or rewrites that prose, `find`
// stops matching and the entry simply stops applying — a correction can't
// outlive the text it corrected. Callers report non-matching entries so they
// can be re-checked or deleted.
//
// Data: seed-data/prereq-errata.json (every entry cites the Cornell source it
// was checked against and the date).

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Erratum = {
  courseId: string;
  field: "prereqText" | "coreqText";
  find: string;
  replace: string;
  reason: string;
  source: string;
  verifiedOn: string;
};

export type ErrataResult = {
  prereqText: string | null;
  coreqText: string | null;
  // Entries for this course whose `find` matched and were applied.
  applied: Erratum[];
  // Entries for this course whose `find` is no longer in the prose.
  unmatched: Erratum[];
};

const ERRATA_PATH = join(__dirname, "seed-data", "prereq-errata.json");

function isErratum(e: unknown): e is Erratum {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.courseId === "string" &&
    (r.field === "prereqText" || r.field === "coreqText") &&
    typeof r.find === "string" &&
    r.find.length > 0 &&
    typeof r.replace === "string" &&
    typeof r.reason === "string" &&
    typeof r.source === "string" &&
    typeof r.verifiedOn === "string"
  );
}

/** Load and validate the errata file; throws on a malformed entry so a bad
 *  edit can never silently disable a correction. */
export function loadErrata(path = ERRATA_PATH): Erratum[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`);
  raw.forEach((e, i) => {
    if (!isErratum(e)) throw new Error(`${path}: entry ${i} is malformed`);
  });
  return raw as Erratum[];
}

/** Apply every erratum for `courseId` to its prose. Pure. */
export function applyErrata(
  courseId: string,
  prereqText: string | null,
  coreqText: string | null,
  errata: Erratum[]
): ErrataResult {
  const out: ErrataResult = { prereqText, coreqText, applied: [], unmatched: [] };
  for (const e of errata) {
    if (e.courseId !== courseId) continue;
    const text = out[e.field];
    if (text != null && text.includes(e.find)) {
      out[e.field] = text.split(e.find).join(e.replace);
      out.applied.push(e);
    } else {
      out.unmatched.push(e);
    }
  }
  return out;
}
