/**
 * Feature switches — the one place to turn a whole feature on or off.
 *
 * Each switch has a default here and an optional build-time override (an env
 * var in .env.* or on the command line), so a build for a particular audience
 * can turn a feature off without editing code. A change takes effect on the
 * next build and deploy.
 */

/** "off" / "false" / "0" / "no" → false; anything else set → true; unset → fallback. */
export function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

export const FEATURES = {
  /**
   * Rate My Professor ratings (spec 013): professor ratings and the RMP link in
   * the course panel, the "varies by instructor" badge on cards, and the
   * professor column in Compare. Off = every professor surface shows its empty
   * state (the instructor timeline goes with it, since it opens from the same
   * section). Override at build time: VITE_FEATURE_RATE_MY_PROFESSOR=off.
   */
  rateMyProfessor: parseFlag(import.meta.env.VITE_FEATURE_RATE_MY_PROFESSOR, true),
  /**
   * Unlock suggestions (spec 008 §3b): hovering a placed card fans out ghost
   * cards for the courses it unlocks, with a "+N more" button. Off for now
   * (2026-11-07, Michael): it fills too much of the board, and "+N more" does
   * nothing when clicked. The quiet "unlocks N" count on cards stays. Turn back
   * on once it's reworked. Override at build time: VITE_FEATURE_UNLOCK_SUGGESTIONS=on.
   */
  unlockSuggestions: parseFlag(import.meta.env.VITE_FEATURE_UNLOCK_SUGGESTIONS, false),
} as const;
