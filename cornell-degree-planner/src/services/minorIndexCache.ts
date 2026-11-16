import type { MinorIndexEntry } from "@/lib/schemas";

/**
 * The session's minor index once read (spec 047 D12), kept apart from
 * services/layers.ts so a reader that only needs names (PlanProvider's
 * "Removed CS minor" toast) can peek without importing the Firestore SDK.
 * services/layers.ts fetchMinorIndex fills it.
 */
let entries: MinorIndexEntry[] | null = null;

/** The minor index if this session already read it, else null (no read). */
export function peekMinorIndex(): MinorIndexEntry[] | null {
  return entries;
}

/** Record the session's minor index (services/layers.ts only); null forgets it. */
export function rememberMinorIndex(next: MinorIndexEntry[] | null): void {
  entries = next;
}
