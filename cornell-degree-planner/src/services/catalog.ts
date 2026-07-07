import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
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

// Batched authoritative fetch for the full docs of a SPECIFIC id set (the
// courses actually on the current plan, or a rendered catalog page — never the
// whole catalog). Firestore bills one read per returned doc, so cost == number
// of ids, not number of queries; we still batch by 10 to cut round-trips using
// the `in` operator's 10-value ceiling. Missing ids are silently absent from the
// result (the caller records them as "fetched" so they aren't re-requested).
export async function fetchCoursesByIds(ids: string[]): Promise<Course[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const out: Course[] = [];
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, "courses"), where(documentId(), "in", batch))
    );
    for (const d of snap.docs) {
      out.push(normalizeCourse(CourseSchema.parse(d.data())));
    }
  }
  return out;
}
