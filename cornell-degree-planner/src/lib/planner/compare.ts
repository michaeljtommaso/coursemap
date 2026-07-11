/**
 * compare.ts (spec 013 §2) — PURE row-builders for the decision-hub compare
 * tray. Every function here takes plain data and returns plain data (no React,
 * no fetching), so the comparison columns are unit-testable in isolation and the
 * component stays a thin presenter. Schedule-fit reuses conflicts.ts's primitive
 * (findConflicts) rather than re-implementing time math (spec boundary: consume
 * the engines, never fork them).
 */

import { findConflicts, type ConflictPlacement } from "./conflicts";
import { parseDayTokens, parseClockToMinutes, primarySection } from "./sections";

/** "CS-2110" → "CS 2110" (display code form). Only the first dash is a
 *  subject/number separator; ids never carry a second one, but replacing just
 *  the first keeps this safe if one ever did. */
export function formatCourseCode(id: string): string {
  return id.replace("-", " ");
}

/**
 * Pinned-pair forbidden-overlap detection (spec 013 §2, "forbidden overlap"
 * row). Two PINNED courses conflict when EITHER lists the other in its
 * forbidden_overlaps ("credit for only one of the two") — the relation is
 * treated as symmetric even when only one side's data records it. Returns, per
 * pinned course id, the display codes of the OTHER pinned courses it overlaps
 * with (deduped, stable order). A course with no overlaps is absent from the map.
 */
export function forbiddenOverlapCodes(
  pinned: { id: string; forbiddenOverlaps: string[] }[]
): Map<string, string[]> {
  const idSet = new Set(pinned.map((p) => p.id));
  const forbids = new Map(pinned.map((p) => [p.id, new Set(p.forbiddenOverlaps)]));
  const out = new Map<string, string[]>();

  for (let i = 0; i < pinned.length; i++) {
    for (let j = i + 1; j < pinned.length; j++) {
      const a = pinned[i];
      const b = pinned[j];
      const aForbidsB = forbids.get(a.id)?.has(b.id) ?? false;
      // Only count the other side if that id is actually pinned (idSet) — a
      // forbidden id that isn't on the tray isn't a pinned-pair conflict.
      const bForbidsA = (forbids.get(b.id)?.has(a.id) ?? false) && idSet.has(a.id);
      if (aForbidsB || bForbidsA) {
        pushUnique(out, a.id, formatCourseCode(b.id));
        pushUnique(out, b.id, formatCourseCode(a.id));
      }
    }
  }
  return out;
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key);
  if (!arr) {
    map.set(key, [value]);
  } else if (!arr.includes(value)) {
    arr.push(value);
  }
}

/**
 * "What it unlocks" row (spec 013 §2) — count + the top few display codes. The
 * unlock ids arrive already merged/canonicalized from the UnlocksMap; this only
 * formats and truncates. `top` is capped at `n` (default 3) and formatted to
 * code form; `count` is the full total.
 */
export function topUnlocks(
  unlockIds: string[],
  n = 3
): { count: number; top: string[] } {
  return {
    count: unlockIds.length,
    top: unlockIds.slice(0, n).map(formatCourseCode),
  };
}

/**
 * "Distribution tags" row (spec 013 §2) — the course's crseAttrs values as small
 * chips. Deduped, order-preserving; empty when the course carries no attrs.
 */
export function distributionTags(
  attrs: { value: string }[] | null | undefined
): string[] {
  if (!attrs || attrs.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of attrs) {
    if (!a.value || seen.has(a.value)) continue;
    seen.add(a.value);
    out.push(a.value);
  }
  return out;
}

export type ScheduleFit =
  | { kind: "fits" }
  | { kind: "collides"; withCode: string }
  | { kind: "none" };

/**
 * "Schedule fit" row (spec 013 §2) — near-horizon only. Compares the pinned
 * course's primary-section meeting times against your near-semester placements
 * via conflicts.ts. Returns:
 *   - { kind: "none" }     — no usable near data (course not offered this term,
 *                            no meeting times, or nothing placed near) → em-dash;
 *   - { kind: "collides" } — first colliding near placement's display code;
 *   - { kind: "fits" }     — has meeting data and collides with nothing near.
 * `target` is the pinned course as a ConflictPlacement; `nearPlacements` are the
 * enrollment-term placements already on the plan (excluding `target` itself).
 */
export function scheduleFit(
  target: ConflictPlacement,
  nearPlacements: ConflictPlacement[]
): ScheduleFit {
  const others = nearPlacements.filter((p) => p.slotId !== target.slotId);
  const conflicts = findConflicts([target, ...others]);
  const involving = conflicts.find(
    (c) => c.aSlotId === target.slotId || c.bSlotId === target.slotId
  );
  if (involving) {
    const otherSlot =
      involving.aSlotId === target.slotId ? involving.bSlotId : involving.aSlotId;
    const other = others.find((p) => p.slotId === otherSlot);
    return { kind: "collides", withCode: other?.courseCode ?? "another course" };
  }
  // No collision. Distinguish an honest "fits" (we actually had times to
  // compare) from "none" (no near data): a "fits" needs BOTH the target to
  // carry a usable meeting window AND at least one near placement to check it
  // against — otherwise an em-dash, never a false "fits".
  if (others.length === 0 || !hasUsableWindow(target)) return { kind: "none" };
  return { kind: "fits" };
}

/** Whether a placement's PRIMARY section (the exact one findConflicts compares)
 *  has at least one meeting with a parseable day pattern + start/end time, so
 *  "fits" never overclaims when the engine actually had nothing to compare. */
function hasUsableWindow(p: ConflictPlacement): boolean {
  const primary = primarySection(p.sections);
  if (!primary) return false;
  for (const m of primary.meetings) {
    const days = parseDayTokens(m.pattern);
    const start = parseClockToMinutes(m.timeStart);
    const end = parseClockToMinutes(m.timeEnd);
    if (days.length > 0 && start != null && end != null && end > start) return true;
  }
  return false;
}

/**
 * Professor-cell empty state for a NULL summary (spec 013 §3a/§4) — the honest
 * text the compare/detail professor cell shows when the ReviewsProvider returns
 * null (always, under the NullAdapter). Far-horizon courses (with a configured
 * target) say instructors aren't announced yet — the absence is a FEATURE, per
 * 012's honesty rule; everything else is a plain em-dash. Kept pure so the
 * NullAdapter smoke test asserts it without mounting a component.
 */
export const EM_DASH = "—";

export function professorEmptyState(
  horizon: "near" | "far" | "past",
  hasTarget: boolean
): string {
  if (horizon === "far" && hasTarget) {
    return "instructors announced closer to the semester";
  }
  return EM_DASH;
}
