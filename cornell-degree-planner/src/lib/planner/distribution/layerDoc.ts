import type { Layer } from "./types";

/**
 * layerDoc.ts (spec 019 D11/D12) — how a layer is stored in `layers/{id}`.
 *
 * Firestore can't hold an array directly inside an array, and layers have one
 * (`subjectGroups: string[][]`, the department map behind `maxPerSubject`).
 * So the doc keeps the fields the app queries on at the top level and the
 * layer itself as JSON text. The seeder writes with `encodeLayerDoc`; the app
 * reads with `decodeLayerDoc` and then validates (LayerSchema + lintLayer) as
 * for any untrusted input.
 */

export type LayerDocFields = {
  id: string;
  kind: Layer["kind"];
  family: Layer["family"];
  /** Major and concentration layers; null on college layers (queryable). */
  programId: string | null;
  catalogYear: string;
  /** The whole layer, JSON-encoded. */
  json: string;
};

export function encodeLayerDoc(layer: Layer): LayerDocFields {
  return {
    id: layer.id,
    kind: layer.kind,
    family: layer.family,
    programId: layer.programId ?? null,
    catalogYear: layer.catalogYear,
    json: JSON.stringify(layer),
  };
}

/** The stored layer, unvalidated, or an error when the doc isn't one. The
 *  top-level copies must agree with the layer they index. */
export function decodeLayerDoc(data: unknown): { ok: true; raw: unknown } | { ok: false; error: string } {
  const d = data as Partial<LayerDocFields> | null;
  if (!d || typeof d.json !== "string") return { ok: false, error: "doc has no layer json" };
  let raw: unknown;
  try {
    raw = JSON.parse(d.json);
  } catch {
    return { ok: false, error: "layer json does not parse" };
  }
  const l = raw as Partial<Layer> | null;
  if (!l || l.kind !== d.kind || l.family !== d.family || (l.programId ?? null) !== (d.programId ?? null)) {
    return { ok: false, error: "doc fields disagree with the layer" };
  }
  return { ok: true, raw };
}
