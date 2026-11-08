/**
 * buildVersion.ts — telling an open tab that a newer build is live.
 *
 * Every build bakes its own id into the bundle (__BUILD_ID__, vite.config.ts)
 * and writes the same id to /version.json. A tab compares the two; when they
 * differ, the site was deployed after the tab loaded and it is running old
 * code. Old code can drop data it doesn't know about when it saves a plan, so
 * the tab offers a reload.
 *
 * index.html is cached by the hosting CDN for up to an hour, so a plain reload
 * can come back with the old build. The reload adds the new id as a query
 * parameter (a URL the cache hasn't seen); the app removes it again on load.
 * Pure helpers; useNewVersion does the fetching.
 */

declare const __BUILD_ID__: string;

/** This bundle's build id. */
export const CURRENT_BUILD: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/** The query parameter the reload adds. */
export const VERSION_PARAM = "v";

/** The build id in a version.json body, or null when it isn't one. */
export function parseVersion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const build = (body as { build?: unknown }).build;
  return typeof build === "string" && build.length > 0 && build.length <= 100 ? build : null;
}

/** A different build is live (an unreadable answer never counts). */
export function isNewBuild(current: string, live: string | null): boolean {
  return live !== null && live !== current;
}

/** Where the reload goes: the same page with the live build's id added. */
export function reloadUrl(href: string, live: string): string {
  const url = new URL(href);
  url.searchParams.set(VERSION_PARAM, live);
  return url.toString();
}

/** The address without the reload's parameter, or null when it has none. */
export function withoutVersionParam(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(VERSION_PARAM)) return null;
  url.searchParams.delete(VERSION_PARAM);
  return url.toString();
}

/** The URL to ask for the live build id: a fresh one each time, so neither
 *  the browser nor the CDN answers from a cache. */
export function versionUrl(origin: string, now: number): string {
  return `${origin}/version.json?t=${now}`;
}
