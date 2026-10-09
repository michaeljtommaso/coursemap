import { useEffect } from "react";

/** App-wide title prefix: every route title reads "Coursemap — <page>". */
export const APP_TITLE = "Coursemap";

export function pageTitle(page: string): string {
  return `${APP_TITLE} — ${page}`;
}

/**
 * Set document.title while the calling route is mounted. Each route sets its
 * own title on mount, so no restore-on-unmount is needed (and none is done —
 * restoring would race the next route's effect under StrictMode).
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
