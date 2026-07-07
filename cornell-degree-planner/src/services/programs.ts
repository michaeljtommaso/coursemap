import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ProgramSchema } from "@/lib/schemas";
import {
  normalizeProgramMeta,
  normalizeProgramSlots,
  normalizeProgramEdges,
} from "@/lib/normalize/normalizeProgram";
import type { Program, ProgramSlotWithData, SlotEdge } from "@/types/db";

/**
 * Programs service — the ONLY module that touches Firestore for program data
 * (house-standard service-layer contract, docs/specs/002 §5). One program doc read
 * reconstructs what used to be three Supabase queries (list, slots+join, edges).
 */

// List metadata for the program dropdown. Reads all program docs once; each is
// tens of KB and there are 13 (all CoE majors, 2026-07), so this is still
// cheap. (A dedicated metadata index could replace this at scale.)
export async function fetchPrograms(): Promise<Program[]> {
  const snap = await getDocs(collection(db, "programs"));
  const programs = snap.docs.map((d) => normalizeProgramMeta(ProgramSchema.parse(d.data())));
  programs.sort((a, b) => a.name.localeCompare(b.name));
  return programs;
}

// One program → its slots (joined) + edges. Replaces useProgramData's two fetches.
export async function fetchProgram(
  id: string
): Promise<{ slots: ProgramSlotWithData[]; edges: SlotEdge[] } | null> {
  const snap = await getDoc(doc(db, "programs", id));
  if (!snap.exists()) return null;
  const parsed = ProgramSchema.parse(snap.data());
  return {
    slots: normalizeProgramSlots(parsed),
    edges: normalizeProgramEdges(parsed),
  };
}
