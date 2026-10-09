import type { Rect } from "@/lib/canvas/zoom";
import type { DerivedEdgeKind } from "@/lib/planner/deriveEdges";

/**
 * edgeGeometry (spec 008 §2c wires + spec 014 §D9 corequisite connector) — the
 * PURE path math behind EdgeLayer. No DOM: rects are content-space card boxes
 * (EdgeLayer measures them via unscaleRect), so every shape is table-testable.
 *
 * Three shapes:
 *
 *   "curve"   — the spec 008 wire, UNCHANGED: a cubic from the feeder's
 *               right-middle to just left of the dependent's left-middle, with
 *               an arrowhead. Every prereq / advisory edge, and every
 *               corequisite edge whose cards sit in DIFFERENT columns.
 *
 *   "stack"   — D9: a corequisite (`concurrent`) edge between two cards in the
 *               SAME column with NO other card between them. A short straight
 *               connector from the bottom-middle of the UPPER card to the
 *               top-middle of the LOWER card (upper/lower by position, not by
 *               edge direction). No arrowhead: the pair is taken together, and
 *               the inter-card gap (~10px) has no room for one.
 *
 *   "bracket" — a corequisite edge in the same column with one or more cards
 *               BETWEEN the pair. A straight connector would run underneath
 *               the intermediate cards (the SVG sits below the cards) and read
 *               as if it joined them, so instead a compact rounded bracket
 *               leaves the upper card's right-middle, runs BRACKET_OUT px
 *               outside the column, and re-enters the lower card's
 *               right-middle. No arrowhead, same reason as "stack". This
 *               replaces the dashed S-shaped side loop the curve formula drew
 *               for same-column edges (it crossed both cards).
 *
 * Same-column prereq edges (always `violated` — a prereq can't sit in its own
 * dependent's semester) keep the curve: D9 changes corequisites only.
 */

export type EdgeShape = "curve" | "stack" | "bracket";

export type EdgeGeometry = {
  shape: EdgeShape;
  /** SVG path data, content-space. */
  d: string;
  /** Draw the arrowhead marker (curves only). */
  arrow: boolean;
};

/** How far the "bracket" runs outside the cards' right edge (content px).
 *  Well inside the 40px inter-column gap, so it never reaches the next column. */
export const BRACKET_OUT = 12;
/** Corner radius of the bracket's two bends (content px). */
export const BRACKET_RADIUS = 6;

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

/** Two cards share a column when their horizontal centres are closer than half
 *  the narrower card's width (columns are fixed-width and ≥40px apart, so this
 *  never confuses neighbours and tolerates sub-pixel measurement noise). */
export function sameColumn(a: Rect, b: Rect): boolean {
  return Math.abs(cx(a) - cx(b)) < Math.min(a.w, b.w) / 2;
}

/** The spec 008 wire, byte-for-byte the pre-D9 formula. */
function curvePath(from: Rect, to: Rect): string {
  const x1 = from.x + from.w;
  const y1 = cy(from);
  const x2 = to.x - 2; // breathe before the arrowhead
  const y2 = cy(to);
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Is any OTHER card in the column sitting between `upper` and `lower`?
 *  "Between" = its vertical centre lies strictly inside the gap from the
 *  upper card's bottom to the lower card's top. `from`/`to` themselves are
 *  excluded by identity (EdgeLayer passes the measured rects map's values). */
function hasCardBetween(upper: Rect, lower: Rect, others: Iterable<Rect>): boolean {
  const top = upper.y + upper.h;
  const bottom = lower.y;
  for (const r of others) {
    if (r === upper || r === lower) continue;
    if (!sameColumn(r, upper)) continue;
    const c = cy(r);
    if (c > top && c < bottom) return true;
  }
  return false;
}

function bracketPath(upper: Rect, lower: Rect): string {
  const xStart = upper.x + upper.w;
  const xEnd = lower.x + lower.w;
  const xr = Math.max(xStart, xEnd) + BRACKET_OUT;
  const y1 = cy(upper);
  const y2 = cy(lower);
  const r = Math.max(0, Math.min(BRACKET_RADIUS, (y2 - y1) / 2, BRACKET_OUT));
  return (
    `M ${xStart} ${y1} H ${xr - r} Q ${xr} ${y1} ${xr} ${y1 + r} ` +
    `V ${y2 - r} Q ${xr} ${y2} ${xr - r} ${y2} H ${xEnd}`
  );
}

/**
 * The path for one derived edge. `others` is every measured card rect on the
 * board (it may include `from`/`to`; they're skipped by identity) — used only
 * to decide stack vs bracket for a same-column corequisite pair.
 */
export function edgeGeometry(
  kind: DerivedEdgeKind,
  from: Rect,
  to: Rect,
  others: Iterable<Rect> = []
): EdgeGeometry {
  if (kind !== "concurrent" || !sameColumn(from, to)) {
    return { shape: "curve", d: curvePath(from, to), arrow: true };
  }
  const [upper, lower] = from.y <= to.y ? [from, to] : [to, from];
  if (hasCardBetween(upper, lower, others)) {
    return { shape: "bracket", d: bracketPath(upper, lower), arrow: false };
  }
  return {
    shape: "stack",
    d: `M ${cx(upper)} ${upper.y + upper.h} L ${cx(lower)} ${lower.y}`,
    arrow: false,
  };
}

/** Unordered key for a same-column corequisite pair — a mutual coreq (A lists
 *  B and B lists A, e.g. a lecture and its lab) derives TWO concurrent edges
 *  that map to the identical stack/bracket path; EdgeLayer draws it once. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
