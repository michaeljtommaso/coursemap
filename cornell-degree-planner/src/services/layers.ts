import type { Layer, LayerFamily } from "@/lib/planner/distribution/types";

/**
 * Layers service (spec 019 D11/D12) — the ONLY module that touches Firestore
 * for requirement layers. `layers/{layerId}` is public-read, Admin-SDK-write.
 *
 * CONTRACT (Phase 3, lane A implements; stubs until then):
 *  - Every layer read goes through `parseLayer`: LayerSchema AND lintLayer.
 *    A layer that fails either is NOT used (roadmap: the schema alone accepts
 *    shapes only the linter rejects).
 */

export type ParsedLayer = { ok: true; layer: Layer } | { ok: false; id: string; error: string };

/** LayerSchema.safeParse + lintLayer. Pure. */
export function parseLayer(id: string, raw: unknown): ParsedLayer {
  void raw;
  return { ok: false, id, error: "not implemented" };
}

/** One layer by id (a major layer's id is its programId); null when absent. */
export async function fetchLayer(id: string): Promise<ParsedLayer | null> {
  void id;
  throw new Error("fetchLayer: not implemented");
}

/** Every college-layer version of a family (CAS: one; CALS: two). */
export async function fetchCollegeLayers(family: LayerFamily): Promise<ParsedLayer[]> {
  void family;
  throw new Error("fetchCollegeLayers: not implemented");
}
