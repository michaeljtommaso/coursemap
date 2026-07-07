import { supabase } from "@/lib/supabase";
import type { Program, ProgramSlotWithData, SlotEdge } from "@/types/db";

export async function fetchPrograms(): Promise<Program[]> {
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchProgramSlots(
  programId: string
): Promise<ProgramSlotWithData[]> {
  const { data, error } = await supabase
    .from("program_slots")
    .select("*, courses(*), elective_groups(*)")
    .eq("program_id", programId)
    .order("suggested_semester")
    .order("slot_row");
  if (error) throw error;
  return (data ?? []) as ProgramSlotWithData[];
}

export async function fetchSlotEdges(programId: string): Promise<SlotEdge[]> {
  const { data, error } = await supabase
    .from("slot_edges")
    .select("*")
    .eq("program_id", programId);
  if (error) throw error;
  return data ?? [];
}
