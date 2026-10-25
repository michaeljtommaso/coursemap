import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ProgramIndexDocSchema, ProgramSchema } from "@/lib/schemas";
import {
  normalizeProgramIndexEntry,
  normalizeProgramMeta,
  normalizeProgramSlots,
} from "@/lib/normalize/normalizeProgram";
import type { Program, ProgramSlotWithData } from "@/types/db";

/**
 * Programs service — the ONLY module that touches Firestore for program data
 * (house-standard service-layer contract, docs/specs/002 §5). One program doc read
 * reconstructs the slots (list, slots+join). Authored edges are dead (spec 008
 * §2b): the program doc's `edges` array is no longer read — the canvas derives
 * its wires from placed courses' prereq/coreq trees.
 */

const byName = (a: Program, b: Program) => a.name.localeCompare(b.name);

let warnedNoIndex = false;
function warnNoIndexOnce(why: string, err?: unknown) {
  if (warnedNoIndex) return;
  warnedNoIndex = true;
  console.warn(`[programs] catalog/programIndex ${why}; reading every program doc instead`, err ?? "");
}

/** Test hook: re-arm the once-per-session fallback warning. */
export function __resetProgramIndexWarningForTests() {
  warnedNoIndex = false;
}

/**
 * The program list (spec 019 D11): ONE read of `catalog/programIndex`, which
 * lists every program — Engineering slot files and Distribution-family majors
 * (layers) alike — with its college, family, twins, Cornell link and status.
 * Hidden programs stay in the list (a student already on one still loads it);
 * the picker filters with `programIsVisible`.
 *
 * Fallback: when the index is missing, unreadable or fails to parse, read
 * every program doc the old way (console.warn once). That keeps the app
 * working before the index is seeded; it can only list Engineering-family
 * program docs.
 */
export async function fetchProgramIndex(): Promise<Program[]> {
  let raw: unknown;
  try {
    const snap = await getDoc(doc(db, "catalog", "programIndex"));
    if (!snap.exists()) {
      warnNoIndexOnce("is missing");
      return fetchPrograms();
    }
    raw = snap.data();
  } catch (err) {
    warnNoIndexOnce("could not be read", err);
    return fetchPrograms();
  }
  const parsed = ProgramIndexDocSchema.safeParse(raw);
  if (!parsed.success) {
    warnNoIndexOnce("failed to parse", parsed.error.issues.slice(0, 3));
    return fetchPrograms();
  }
  return parsed.data.entries.map(normalizeProgramIndexEntry).sort(byName);
}

// List metadata for the program dropdown — the pre-index path, now
// fetchProgramIndex's fallback. Reads all program docs once; each is
// tens of KB and there are ~15 majors (13 engineering + Information Science and
// Communication, the first two CALS non-eng majors, added 2026-07-17) plus the
// blank canvas, so this is still cheap. (A dedicated metadata index could
// replace this at scale.) NB: no college filter here or in useMajorMatch — the
// grid and the ranking surface every program doc, which is why adding a major
// is pure data entry.
export async function fetchPrograms(): Promise<Program[]> {
  const snap = await getDocs(collection(db, "programs"));
  const programs = snap.docs.map((d) => normalizeProgramMeta(ProgramSchema.parse(d.data())));
  programs.sort(byName);
  return programs;
}

// One program → its slots (joined). Replaces useProgramData's slot fetch.
export async function fetchProgram(
  id: string
): Promise<{ slots: ProgramSlotWithData[] } | null> {
  const snap = await getDoc(doc(db, "programs", id));
  if (!snap.exists()) return null;
  const parsed = ProgramSchema.parse(snap.data());
  return {
    slots: normalizeProgramSlots(parsed),
  };
}
