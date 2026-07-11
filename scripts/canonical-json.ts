// scripts/canonical-json.ts
// Stable, key-order-insensitive JSON comparison for PrereqExpr trees (and any
// plain JSON value). Firestore does NOT guarantee that a document read returns
// object keys in the same order they were written ({id,type} vs {type,id}), so
// a raw JSON.stringify comparison against freshly-constructed parser output
// produces false "changed tree" diffs and breaks apply idempotency. Pure — no
// IO — so the offline corpus runner can assert it directly.

/** Deterministic stringify: object keys sorted recursively, arrays keep order,
 *  undefined normalizes to null (Firestore has no undefined). */
export function canonicalStringify(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalStringify).join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

/** Key-order-insensitive deep equality (null and undefined compare equal —
 *  both mean "no tree"). */
export function treeEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
