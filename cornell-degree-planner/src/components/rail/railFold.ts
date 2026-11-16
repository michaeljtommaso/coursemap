import { useCallback, useState } from "react";

/**
 * railFold.ts (spec 047 D6) — which extra programs the rail shows unfolded,
 * remembered per plan in localStorage. A per-viewer convenience: no plan
 * field, no rules change. Every program starts folded, so only the unfolded
 * ones are stored. Storage can be missing or throw (private windows, blocked
 * site data): every access is guarded and the rail works without it, holding
 * the state in memory for the visit.
 */

const KEY_PREFIX = "coursemap.railOpenPrograms.";
/** Never more than a plan's extra programs (4); a little slack for stale ids. */
const MAX_STORED = 8;

export function readOpenPrograms(planId: string): string[] {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + planId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

export function writeOpenPrograms(planId: string, ids: readonly string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(KEY_PREFIX + planId);
    else window.localStorage.setItem(KEY_PREFIX + planId, JSON.stringify(ids.slice(0, MAX_STORED)));
  } catch {
    // Storage unavailable: the fold state lives for this visit only.
  }
}

/** The unfolded program ids for `planId` and a toggle. No plan id yet: memory only. */
export function useRailFold(planId: string | null | undefined): [ReadonlySet<string>, (programId: string) => void] {
  const key = planId ?? null;
  const [state, setState] = useState<{ key: string | null; open: string[] }>(() => ({
    key,
    open: key ? readOpenPrograms(key) : [],
  }));
  // Another plan loaded: read its own state (the render-time reset pattern).
  let current = state;
  if (state.key !== key) {
    current = { key, open: key ? readOpenPrograms(key) : [] };
    setState(current);
  }
  const open = current.open;
  const toggle = useCallback(
    (programId: string) => {
      const next = open.includes(programId) ? open.filter((x) => x !== programId) : [...open, programId];
      if (key) writeOpenPrograms(key, next);
      setState({ key, open: next });
    },
    [open, key]
  );
  return [new Set(open), toggle];
}
