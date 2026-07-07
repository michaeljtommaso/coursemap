/** Single reduced-motion gate for every scripted animation (spec 004 §8).
 *  CSS animations use the media query directly; anime.js call sites use this. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
