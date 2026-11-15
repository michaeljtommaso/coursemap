import { useCallback, useSyncExternalStore } from "react";

/**
 * pageLayout (spec 045 D9) — the Requirements page's columns: outline ·
 * table · side panel. From 1280px all three sit side by side. Below that,
 * while a requirement's panel is open, the outline collapses to a narrow
 * column with a "Show the outline" button (it then opens over the table), so
 * the table and the panel keep their room. Panel closed: the outline returns.
 * Under 1024px the app's "use a bigger screen" notice takes over.
 */

/** The window width from which the outline, table and panel all fit. */
export const WIDE_QUERY = "(min-width: 1280px)";

export type OutlineMode = "full" | "collapsed";

export function outlineMode(wide: boolean, panelOpen: boolean): OutlineMode {
  return !wide && panelOpen ? "collapsed" : "full";
}

/** Whether a media query matches, kept in step with the window. With no
 *  matchMedia (tests, old browsers) it reads `fallback`. */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
      if (!mql) return () => {};
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    [query]
  );
  const read = () => {
    const mql = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
    return mql ? mql.matches : fallback;
  };
  return useSyncExternalStore(subscribe, read, () => fallback);
}
