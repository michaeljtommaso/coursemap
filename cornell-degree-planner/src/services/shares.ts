import { doc, getDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ShareSchema, ShareCreateSchema, type ShareDoc } from "@/lib/schemas";

/**
 * Shares service (spec 005 §5) — frozen, read-only plan snapshots. The id is an
 * unguessable uuid capability; the doc is IMMUTABLE after create (no update
 * path exists in rules — a re-share mints a new link). Only this module
 * touches /shares (house-standard service-layer contract).
 *
 * RATE LIMIT (cost control, spec 002 §8c): the create ships in an atomic batch
 * that stamps users/{uid}.lastShareAt = serverTimestamp(); firestore.rules
 * verifies the stamp via getAfter() and requires the previous stamp to be
 * ≥30s old. A create attempted inside the cooldown is rejected SERVER-SIDE
 * with permission-denied — the client cooldown in TopBar is UX, not the
 * boundary (validate twice).
 *
 * SHAPE (spec 014): new shares are written in the placement shape —
 * placements, courseSnapshots, completedIds, inProgressIds,
 * waivedRequirementIds, schemaVersion 3. Shares written before spec 014 are
 * immutable slot-shape docs; fetchShare still parses them (the placement
 * fields default to empty and the old fields pass through) for ShareView's
 * old-shape reader.
 */

export const SHARE_COOLDOWN_MS = 30_000;

export type CreateShareInput = Omit<ShareDoc, "createdAt">;

export async function createShare(input: CreateShareInput): Promise<string> {
  const shareId = crypto.randomUUID();
  // Validate the JSON-visible slice; strip any undefined values (Firestore
  // rejects undefined and fails the whole write).
  const clean = JSON.parse(JSON.stringify(input));
  ShareCreateSchema.parse({ ...clean, createdAt: new Date() });

  const batch = writeBatch(db);
  batch.set(doc(db, "shares", shareId), {
    ...clean,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, "users", clean.createdBy), {
    lastShareAt: serverTimestamp(),
  });
  await batch.commit();
  return shareId;
}

export async function fetchShare(shareId: string): Promise<ShareDoc | null> {
  const snap = await getDoc(doc(db, "shares", shareId));
  if (!snap.exists()) return null;
  try {
    return ShareSchema.parse(snap.data());
  } catch (err) {
    console.warn("[shares] share doc failed validation", err);
    return null;
  }
}
