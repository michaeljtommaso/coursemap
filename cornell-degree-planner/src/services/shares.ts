import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ShareSchema, type ShareDoc } from "@/lib/schemas";

/**
 * Shares service (spec 005 §5) — frozen, read-only plan snapshots. The id is an
 * unguessable uuid capability; the doc is IMMUTABLE after create (no update
 * path exists in rules — a re-share mints a new link). Only this module
 * touches /shares (house-standard service-layer contract).
 */

export type CreateShareInput = Omit<ShareDoc, "createdAt">;

export async function createShare(input: CreateShareInput): Promise<string> {
  const shareId = crypto.randomUUID();
  // Validate the JSON-visible slice; strip any undefined values (Firestore
  // rejects undefined and fails the whole write).
  const clean = JSON.parse(JSON.stringify(input));
  ShareSchema.parse({ ...clean, createdAt: new Date() });
  await setDoc(doc(db, "shares", shareId), {
    ...clean,
    createdAt: serverTimestamp(),
  });
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
