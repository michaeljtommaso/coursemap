import type { CatalogIndexRecord } from "@/lib/schemas";
import type { Course } from "@/types/db";

// A compact index record is display-complete for search results; project it to
// the Course shape the catalog UI renders (unknown fields default harmlessly).
export function recordToCourse(r: CatalogIndexRecord): Course {
  return {
    id: r.id,
    subject: r.subject,
    number: r.number,
    title: r.title,
    credits_min: r.creditsMin,
    credits_max: r.creditsMax,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
}
