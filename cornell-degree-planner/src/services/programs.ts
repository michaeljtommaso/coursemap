import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ProgramSchema } from "@/lib/schemas";
import {
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

// List metadata for the program dropdown. Reads all program docs once; each is
// tens of KB and there are ~15 majors (13 engineering + Information Science and
// Communication, the first two CALS non-eng majors, added 2026-07-17) plus the
// blank canvas, so this is still cheap. (A dedicated metadata index could
// replace this at scale.) NB: no college filter here or in useMajorMatch — the
// grid and the ranking surface every program doc, which is why adding a major
// is pure data entry.
export async function fetchPrograms(): Promise<Program[]> {
  const snap = await getDocs(collection(db, "programs"));
  const programs = snap.docs.map((d) => normalizeProgramMeta(ProgramSchema.parse(d.data())));
  programs.sort((a, b) => a.name.localeCompare(b.name));
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
