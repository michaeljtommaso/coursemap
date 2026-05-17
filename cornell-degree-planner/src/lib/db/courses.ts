import { supabase } from "@/lib/supabase";
import type { Course } from "@/types/db";

export async function searchCourses(
  query: string,
  limit = 40
): Promise<Course[]> {
  const q = query.trim();
  let builder = supabase.from("courses").select("*").limit(limit);

  if (q) {
    // Normalize "CS 1110" → "CS-1110" for id matching; keep raw for title
    const idQ = q.toUpperCase().replace(/\s+/g, "-");
    builder = builder.or(`id.ilike.%${idQ}%,title.ilike.%${q}%`);
  } else {
    builder = builder.order("subject").order("number");
  }

  const { data, error } = await builder;
  if (error) throw error;
  return data;
}
