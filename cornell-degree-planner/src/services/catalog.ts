import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  CatalogIndexChunkSchema,
  CatalogMetaSchema,
  CourseSchema,
  type CatalogIndexRecord,
  type CatalogMetaDoc,
} from "@/lib/schemas";
import { normalizeCourse } from "@/lib/normalize/normalizeCourse";
import type { Course } from "@/types/db";

/**
 * Catalog service — the ONLY module besides programs.ts / plans.ts that touches
 * Firestore for catalog data (house-standard service-layer contract, docs/specs/002 §5).
 * Reads: snap.data() → Zod-validate → normalizer → typed snake_case object.
 * No raw getDoc/onSnapshot lives outside services/.
 */

// Fetch every catalogIndex chunk once (spec §3: ~1 read for the 50-course seed,
// ~5 post-roster-sync). Returns compact search records for the in-memory index.
export async function fetchCatalogIndex(): Promise<CatalogIndexRecord[]> {
  const snap = await getDocs(collection(db, "catalogIndex"));
  const records: CatalogIndexRecord[] = [];
  for (const d of snap.docs) {
    const parsed = CatalogIndexChunkSchema.parse(d.data());
    records.push(...parsed.records);
  }
  return records;
}

export async function fetchCatalogMeta(): Promise<CatalogMetaDoc> {
  const snap = await getDoc(doc(db, "catalog", "meta"));
  if (!snap.exists()) throw new Error("catalog/meta not found");
  return CatalogMetaSchema.parse(snap.data());
}

// On-demand full course record (freshness-sensitive fields: description,
// prereqExpr). Snapshots on the index/program docs cover display; this is the
// authoritative read.
export async function fetchCourse(id: string): Promise<Course | null> {
  const snap = await getDoc(doc(db, "courses", id));
  if (!snap.exists()) return null;
  return normalizeCourse(CourseSchema.parse(snap.data()));
}
