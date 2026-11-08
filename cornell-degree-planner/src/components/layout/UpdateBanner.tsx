import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useNewVersion } from "@/hooks/useNewVersion";
import { reloadUrl, withoutVersionParam } from "@/lib/version/buildVersion";

/**
 * UpdateBanner — tells a tab that a newer build of the site is live and offers
 * a reload (buildVersion.ts). Bottom-left so it never covers the bottom-centre
 * toast; above every in-app layer but below the drag ghost. "Later" hides it
 * until the student comes back to the tab (it shows again then).
 *
 * Also removes the reload's version parameter from the address once the new
 * build has loaded, so it never ends up in a bookmark or a shared link.
 *
 * DOM contract (e2e): root [data-update-banner].
 */
export function UpdateBanner({ live: liveOverride }: { live?: string | null } = {}) {
  const detected = useNewVersion();
  const live = liveOverride !== undefined ? liveOverride : detected;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const clean = withoutVersionParam(window.location.href);
    if (clean) window.history.replaceState(window.history.state, "", clean);
  }, []);

  useEffect(() => {
    if (!hidden) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setHidden(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hidden]);

  if (!live || hidden) return null;

  return (
    <div
      role="status"
      data-update-banner
      style={{ zIndex: "var(--z-toast)" }}
      className="fixed bottom-4 left-4 flex max-w-sm items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-xl"
    >
      <RotateCw className="mt-0.5 h-4 w-4 flex-none text-drop-text" aria-hidden="true" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="t-label font-semibold text-ink">Coursemap was updated</p>
          <p className="t-meta text-ink-3">Reload to get the latest version. Your plan is saved.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.replace(reloadUrl(window.location.href, live))}
            className="rounded-md bg-ink px-3 py-1 t-label font-semibold text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="rounded-md px-2 py-1 t-meta text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
