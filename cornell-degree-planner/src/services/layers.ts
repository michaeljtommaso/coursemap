import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LayerSchema, MinorIndexSchema, type MinorIndexEntry } from "@/lib/schemas";
import { lintLayer } from "@/lib/planner/distribution/lintLayer";
import { decodeLayerDoc } from "@/lib/planner/distribution/layerDoc";
import { peekMinorIndex, rememberMinorIndex } from "./minorIndexCache";
import type { Layer, LayerFamily } from "@/lib/planner/distribution/types";

/**
 * Layers service (spec 019 D11/D12) — the ONLY module that touches Firestore
 * for requirement layers. `layers/{layerId}` is public-read, Admin-SDK-write
 * (written by scripts/seed-layers.ts).
 *
 *  - Every layer read goes through `parseLayer`: LayerSchema AND lintLayer.
 *    A layer that fails either is NOT used (roadmap: the schema alone accepts
 *    shapes only the linter rejects).
 *  - A major layer's id is its programId; a concentration layer's id is
 *    `<programId>--<concentrationId>`; college layers carry their family; a
 *    minor layer's id is its minor id (spec 047 D12: fetched by id only).
 */

export type ParsedLayer = { ok: true; layer: Layer } | { ok: false; id: string; error: string };

/** LayerSchema.safeParse + lintLayer. Pure. */
export function parseLayer(id: string, raw: unknown): ParsedLayer {
  const parsed = LayerSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, id, error: `schema: ${issues}` };
  }
  const layer = parsed.data as Layer;
  if (layer.id !== id) return { ok: false, id, error: `doc id ${id} does not match layer id ${layer.id}` };
  const lint = lintLayer(layer);
  if (lint.length > 0) return { ok: false, id, error: `lint: ${lint.slice(0, 3).join("; ")}` };
  return { ok: true, layer };
}

/** Decode a stored doc (layerDoc.ts: the layer is JSON text, since Firestore
 *  can't hold its nested arrays), parse, and report: a rejected layer is
 *  logged once per read. */
function parseLogged(id: string, data: unknown): ParsedLayer {
  const decoded = decodeLayerDoc(data);
  const result: ParsedLayer = decoded.ok
    ? parseLayer(id, decoded.raw)
    : { ok: false, id, error: `doc: ${decoded.error}` };
  if (!result.ok) console.error(`[layers] layer ${id} rejected: ${result.error}`);
  return result;
}

/** One layer by id (a major layer's id is its programId); null when absent. */
export async function fetchLayer(id: string): Promise<ParsedLayer | null> {
  const snap = await getDoc(doc(db, "layers", id));
  if (!snap.exists()) return null;
  return parseLogged(id, snap.data());
}

/** Every college-layer version of a family (CAS: one; CALS: two). */
export async function fetchCollegeLayers(family: LayerFamily): Promise<ParsedLayer[]> {
  const snap = await getDocs(
    query(collection(db, "layers"), where("family", "==", family), where("kind", "==", "college"))
  );
  return snap.docs.map((d) => parseLogged(d.id, d.data()));
}

/** The session's minor index read, in flight or done (a failed read is
 *  forgotten, so the next call retries); its result lands in
 *  minorIndexCache.ts. */
let minorIndexRead: Promise<MinorIndexEntry[]> | null = null;

/**
 * Every minor (spec 047 D12): ONE read of `catalog/minorIndex`, parsed with
 * MinorIndexSchema, cached for the session (concurrent callers share the
 * read). No doc yet (no minors seeded) reads as []. A doc that fails the
 * schema rejects, like a failed read, and is not cached. Minor layers
 * themselves load through fetchLayer(id).
 */
export function fetchMinorIndex(): Promise<MinorIndexEntry[]> {
  if (minorIndexRead) return minorIndexRead;
  const read = (async () => {
    const snap = await getDoc(doc(db, "catalog", "minorIndex"));
    if (!snap.exists()) return [];
    const parsed = MinorIndexSchema.safeParse(snap.data());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`minor index rejected: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "malformed"}`);
    }
    return parsed.data.entries;
  })();
  minorIndexRead = read;
  read.then(
    (entries) => {
      if (minorIndexRead === read) rememberMinorIndex(entries);
    },
    (err) => {
      console.warn("[layers] minor index read failed", err);
      if (minorIndexRead === read) minorIndexRead = null;
    }
  );
  return read;
}

export { peekMinorIndex };

/** Test seam: forget the session's minor index. */
export function resetMinorIndexCache(): void {
  minorIndexRead = null;
  rememberMinorIndex(null);
}

/** Every concentration layer of one program (none for most majors). */
export async function fetchConcentrationLayers(programId: string): Promise<ParsedLayer[]> {
  const snap = await getDocs(
    query(collection(db, "layers"), where("programId", "==", programId), where("kind", "==", "concentration"))
  );
  return snap.docs.map((d) => parseLogged(d.id, d.data()));
}
