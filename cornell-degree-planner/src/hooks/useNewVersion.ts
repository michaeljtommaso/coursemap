import { useEffect, useState } from "react";
import { CURRENT_BUILD, isNewBuild, parseVersion, versionUrl } from "@/lib/version/buildVersion";

/** How often an open, visible tab asks which build is live. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * useNewVersion — the id of a newer live build, or null while this tab runs
 * the live one. Asks /version.json every few minutes while the tab is visible
 * and whenever it comes back into view; never in development (no version file)
 * unless `enabled` says so. A failed or odd answer is ignored (offline, a
 * hosting hiccup): only a readable, different id counts. Once a newer build is
 * found it stops asking.
 */
export function useNewVersion({
  enabled = import.meta.env.PROD,
  intervalMs = VERSION_CHECK_INTERVAL_MS,
  current = CURRENT_BUILD,
  fetchVersion = defaultFetchVersion,
}: {
  enabled?: boolean;
  intervalMs?: number;
  current?: string;
  fetchVersion?: () => Promise<unknown>;
} = {}): string | null {
  const [live, setLive] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || live !== null) return;
    let stopped = false;
    let inFlight = false;

    const check = async () => {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const build = parseVersion(await fetchVersion());
        if (!stopped && isNewBuild(current, build)) setLive(build);
      } catch {
        // Offline or a hosting hiccup: try again next time.
      } finally {
        inFlight = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(() => void check(), intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, intervalMs, current, fetchVersion, live]);

  return live;
}

async function defaultFetchVersion(): Promise<unknown> {
  const res = await fetch(versionUrl(window.location.origin, Date.now()), { cache: "no-store" });
  if (!res.ok) throw new Error(`version check: HTTP ${res.status}`);
  return res.json();
}
