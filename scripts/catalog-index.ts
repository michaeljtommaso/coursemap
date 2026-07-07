// scripts/catalog-index.ts
// Shared catalogIndex chunk logic, extracted from roster-sync.ts so parse-prereqs
// can regenerate the same denormalized index (and its hasPrereqs flags) after it
// writes parsed prereqExpr trees. Single source of truth for chunk shape/size.

import type { Firestore, WriteBatch } from "firebase-admin/firestore";

export const CHUNK_SIZE = 300; // mirror seed-firestore.ts (spec §3)

export type IndexRecord = {
  id: string;
  subject: string;
  number: string;
  title: string;
  creditsMin: number;
  creditsMax: number;
  hasPrereqs: boolean;
};

// Build the sorted index records from raw course docs. hasPrereqs is true when a
// course has a non-null prereqExpr (coreqExpr does not flip the dot — matches the
// original roster-sync behavior).
export function buildIndexRecords(
  courses: Array<Record<string, any>>
): IndexRecord[] {
  return [...courses]
    .sort(
      (a, b) =>
        String(a.subject).localeCompare(String(b.subject)) ||
        String(a.number).localeCompare(String(b.number))
    )
    .map((c) => ({
      id: c.id,
      subject: c.subject,
      number: c.number,
      title: c.title,
      creditsMin: c.creditsMin,
      creditsMax: c.creditsMax,
      hasPrereqs: c.prereqExpr != null,
    }));
}

// Regenerate catalogIndex/chunk-NNN docs from index records, deleting any stale
// trailing chunks from a previously larger catalog. Returns the number of chunks
// written and the number of document ops committed (for write-quota accounting).
// `commitBatch` lets the caller thread its own flush/write-count bookkeeping; if
// omitted, a simple internal batching is used (400-op flush).
export async function regenerateCatalogIndex(
  db: Firestore,
  records: IndexRecord[]
): Promise<{ chunkCount: number; ops: number }> {
  const chunkCount = Math.max(1, Math.ceil(records.length / CHUNK_SIZE));
  let ops = 0;
  let batch: WriteBatch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if ((force && pending > 0) || pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (let i = 0; i < chunkCount; i++) {
    const id = `chunk-${String(i).padStart(3, "0")}`;
    const slice = records.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    batch.set(db.collection("catalogIndex").doc(id), { records: slice });
    pending++;
    ops++;
    await flush();
  }

  // Reap stale chunks beyond the new count.
  const existing = await db.collection("catalogIndex").get();
  for (const d of existing.docs) {
    const n = Number(d.id.replace("chunk-", ""));
    if (!Number.isNaN(n) && n >= chunkCount) {
      batch.delete(d.ref);
      pending++;
      ops++;
      await flush();
    }
  }
  await flush(true);
  return { chunkCount, ops };
}
