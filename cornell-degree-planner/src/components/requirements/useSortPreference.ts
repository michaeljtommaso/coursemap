import { useCallback, useState } from "react";

/**
 * Still-needed sort choice (spec 014 D2), remembered per viewer in
 * localStorage. Every read/write is wrapped: private windows, blocked site data
 * or previews can throw, and the panel must still render (default: category).
 */

export type SortMode = "category" | "semester";

const KEY = "coursemap:still-needed-sort";

function readMode(): SortMode {
  try {
    return window.localStorage.getItem(KEY) === "semester" ? "semester" : "category";
  } catch {
    return "category";
  }
}

export function useSortPreference(): [SortMode, (mode: SortMode) => void] {
  const [mode, setMode] = useState<SortMode>(readMode);
  const update = useCallback((next: SortMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage unavailable — the choice just lasts for this session.
    }
  }, []);
  return [mode, update];
}
