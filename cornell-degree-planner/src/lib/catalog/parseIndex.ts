import { CatalogIndexRecordSchema, type CatalogIndexRecord } from "@/lib/schemas";

/**
 * Parse catalogIndex chunk docs record by record. A record that fails the
 * schema is skipped and reported, instead of failing the whole index: on
 * 2026-11-08 one course with no title (Cornell's roster had none) made the app
 * reject every chunk, and course search showed "Couldn't reach the course
 * catalog" for everyone until the index was restored. One bad course now costs
 * only that course.
 */
export function parseIndexChunks(chunks: readonly unknown[]): {
  records: CatalogIndexRecord[];
  skipped: string[];
} {
  const records: CatalogIndexRecord[] = [];
  const skipped: string[] = [];
  for (const chunk of chunks) {
    const raw = (chunk as { records?: unknown } | null)?.records;
    if (!Array.isArray(raw)) continue;
    for (const r of raw) {
      const parsed = CatalogIndexRecordSchema.safeParse(r);
      if (parsed.success) records.push(parsed.data);
      else skipped.push(String((r as { id?: unknown } | null)?.id ?? "(no id)"));
    }
  }
  return { records, skipped };
}
