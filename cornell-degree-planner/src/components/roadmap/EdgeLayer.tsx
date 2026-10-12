import { useLayoutEffect, useMemo, useState } from "react";
import type { DerivedEdge } from "@/lib/planner/deriveEdges";
import { unscaleRect, type Rect } from "@/lib/canvas/zoom";
import { edgeGeometry, pairKey } from "@/lib/canvas/edgeGeometry";
import { layoutRect } from "@/lib/drag/layoutMeasure";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * EdgeLayer (spec 004 §1 + overnight brief; spec 008 §2c renderer switch) —
 * the prereq "wires" between cards, now drawn from DERIVED edges rather than
 * authored ones.
 *
 * Geometry: cards are real DOM nodes in CSS-grid columns; this layer measures
 * them relative to the canvas CONTENT element (both scroll together, so the
 * coordinates are scroll-independent) via a ref registry + one ResizeObserver.
 *
 * Edge truth (spec 008): every edge is a `DerivedEdge` walked from a placed
 * course's real prereq/coreq tree (deriveEdges). Its `kind` and `state` ARE the
 * truth — the same semester rules the card status engine uses — so the edge
 * layer and the card can no longer disagree, and there is no separate statusMap
 * lookup anymore.
 *
 * Ids (spec 014): the registry, edges, hover and pulse are all keyed by board
 * PLACEMENT id.
 *
 * Path shapes live in the pure lib/canvas/edgeGeometry (unit-tested):
 *   curve   → feeder right-middle → dependent left-middle, arrowhead. Every
 *             prereq/advisory edge and every cross-column corequisite.
 *   stack   → spec 014 §D9: corequisites stacked ADJACENT in one column get a
 *             short straight connector, bottom-middle of the upper card to
 *             top-middle of the lower card. Solid (a "4 4" dash on a ~10px
 *             line reads as a stray tick), no arrowhead.
 *   bracket → corequisites in one column with cards BETWEEN them: a compact
 *             rounded bracket just outside the column's right edge (a straight
 *             line would run under the middle cards and seem to join them).
 *             Dashed like other concurrent wires, no arrowhead.
 *   A mutual corequisite (A↔B, e.g. lecture + lab) derives two edges with the
 *   same stack/bracket path; it is drawn ONCE, lit/pulsed if either edge is.
 *
 * Visual language by kind:
 *   prereq      → solid line + arrowhead
 *   concurrent  → dashed line ("4 4") + arrowhead on cross-column curves; the
 *                 stack/bracket shapes above for same-column pairs. NOTE: the
 *                 old authored `coreq` double-line RETIRES with authored edges
 *                 (spec 008 §2c).
 *   advisory    → dashed with a wider gap ("2 6"), reduced base opacity (×0.7).
 *                 Red only when violated: its feeder is on the board but too
 *                 late, which is exactly when the engine blocks an advisory
 *                 (satisfies.evaluate, boardIds).
 * Color by state: an edge whose feeder is NOT strictly/at-or-
 * earlier than its dependent is `state: "violated"` → drawn in --destructive.
 * Satisfied edges use the neutral scheme (in-chain --text-3, else --border-strong).
 *
 * Interaction ("how classes talk to each other"):
 *   - Hovering/focusing a card lifts its FULL chain (ancestors + descendants):
 *     chain edges darken and carry a slow dash-flow; unrelated edges recede.
 *   - Completing a course fires a one-shot pulse down its outgoing edges.
 *   - All motion is CSS keyframes, disabled under prefers-reduced-motion
 *     (tokens.css); the chain-recede opacity fade is dropped too.
 */

export type EdgePulse = { placementId: string; key: number } | null;

/** Stable synthetic id for chain sets / pulse matching (edges carry no id). */
function edgeId(e: DerivedEdge): string {
  return `${e.fromPlacementId}>${e.toPlacementId}:${e.kind}`;
}

function measure(
  registry: Map<string, HTMLElement>,
  contentEl: HTMLElement,
  scale: number
): Map<string, Rect> {
  const base = contentEl.getBoundingClientRect();
  const out = new Map<string, Rect>();
  for (const [id, el] of registry) {
    // getBoundingClientRect is zoom-affected; the content is zoomed from its
    // top-left, so dividing the (rect − base) delta AND the size by the zoom
    // recovers the content-space coordinates the SVG draws in. At scale 1
    // this is a pass-through — byte-for-byte the pre-zoom behavior (spec §F2).
    // layoutRect drops a card's transient translateY (hover lift, gliding
    // neighbours): this measures once per change, and a mid-glide rect would
    // leave the arrows pointing at where the card was a frame into its glide.
    out.set(id, unscaleRect(layoutRect(el, scale), base, scale));
  }
  return out;
}

/** BFS the chain (both directions) from a placement; returns the edge keys involved. */
function chainEdges(edges: DerivedEdge[], from: string | null): Set<string> {
  const result = new Set<string>();
  if (!from) return result;
  const up = new Map<string, DerivedEdge[]>(); // toPlacementId → edges
  const down = new Map<string, DerivedEdge[]>(); // fromPlacementId → edges
  for (const e of edges) {
    (down.get(e.fromPlacementId) ?? down.set(e.fromPlacementId, []).get(e.fromPlacementId)!).push(e);
    (up.get(e.toPlacementId) ?? up.set(e.toPlacementId, []).get(e.toPlacementId)!).push(e);
  }
  const walk = (start: string, dir: "up" | "down") => {
    const queue = [start];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of (dir === "down" ? down : up).get(cur) ?? []) {
        result.add(edgeId(e));
        queue.push(dir === "down" ? e.toPlacementId : e.fromPlacementId);
      }
    }
  };
  walk(from, "down");
  walk(from, "up");
  return result;
}

export function EdgeLayer({
  edges,
  registry,
  contentEl,
  layoutVersion,
  scale = 1,
  hoverPlacementId,
  pulse,
}: {
  edges: DerivedEdge[];
  registry: Map<string, HTMLElement>;
  contentEl: HTMLElement | null;
  /** Bumped whenever a card registers/unregisters, to trigger re-measure. */
  layoutVersion: number;
  /** Canvas zoom factor (spec 006 §F2). Rect deltas are divided by it so arrows
   *  stay aligned when the content is scaled. Defaults to 1 (no zoom). */
  scale?: number;
  hoverPlacementId: string | null;
  pulse: EdgePulse;
}) {
  const [rects, setRects] = useState<Map<string, Rect>>(new Map());

  useLayoutEffect(() => {
    if (!contentEl) return;
    let raf = 0;
    const remeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRects(measure(registry, contentEl, scale)));
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(contentEl);
    for (const el of registry.values()) ro.observe(el);
    // Late font swap can shift card heights after first paint.
    document.fonts?.ready.then(remeasure).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // `scale` in the deps re-measures on every zoom change (spec §F2).
  }, [contentEl, registry, layoutVersion, edges, scale]);

  const activeChain = useMemo(() => chainEdges(edges, hoverPlacementId), [edges, hoverPlacementId]);
  const hasChain = activeChain.size > 0;
  const pulseEdges = useMemo(() => {
    if (!pulse) return new Set<string>();
    return new Set(edges.filter((e) => e.fromPlacementId === pulse.placementId).map(edgeId));
  }, [edges, pulse]);

  // Every measured card, for the stack-vs-bracket "anything between?" test.
  const allRects = useMemo(() => [...rects.values()], [rects]);
  const reduceMotion = prefersReducedMotion();
  // Same-column corequisite pairs already drawn this render (mutual coreqs
  // derive two edges onto one path — draw it once).
  const drawnPairs = new Set<string>();

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="edge-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0.8 L 7.2 4 L 0 7.2 z" fill="context-stroke" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const id = edgeId(edge);
        const from = rects.get(edge.fromPlacementId);
        const to = rects.get(edge.toPlacementId);
        if (!from || !to) return null;

        const geo = edgeGeometry(edge.kind, from, to, allRects);
        const d = geo.d;

        // Same-column corequisite: the path has no direction, so its mutual
        // twin (B→A) is the same line — draw once, lit/pulsed if either is.
        let twinId: string | null = null;
        if (geo.shape !== "curve") {
          const key = pairKey(edge.fromPlacementId, edge.toPlacementId);
          if (drawnPairs.has(key)) return null;
          drawnPairs.add(key);
          twinId = `${edge.toPlacementId}>${edge.fromPlacementId}:${edge.kind}`;
        }

        const inChain = activeChain.has(id) || (twinId !== null && activeChain.has(twinId));
        const pulsing = pulseEdges.has(id) || (twinId !== null && pulseEdges.has(twinId));

        // A violated edge is a feeder placed too late: red for every kind. An
        // advisory blocks in exactly that case too (satisfies.evaluate), so its
        // wire turns red along with the card.
        const violated = edge.state === "violated";
        const isAdvisory = edge.kind === "advisory";

        // Rest → chain-active → receded opacities; advisory rides at ×0.7 so it
        // reads as the quiet, non-blocking hint spec 007 wants.
        const baseOpacity = (hasChain ? (inChain ? 1 : 0.1) : 0.55) * (isAdvisory ? 0.7 : 1);
        const stroke = violated
          ? "var(--destructive)"
          : inChain
            ? "var(--text-3)"
            : "var(--border-strong)";
        // The flowing-current / pulse overlay is normally neutral ink (`--text`)
        // so it reads as "energy moving," not a status color. A violated edge
        // keeps the overlay red too, so the red base wire never neutralizes to
        // ink while it's part of the highlighted chain.
        const overlayStroke = violated ? "var(--destructive)" : "var(--text)";
        const dash = isAdvisory
          ? "2 6"
          : edge.kind === "concurrent" && geo.shape !== "stack"
            ? "4 4"
            : undefined;

        return (
          <g
            key={id}
            data-edge-shape={geo.shape}
            style={{ opacity: baseOpacity, transition: reduceMotion ? undefined : "opacity 180ms ease" }}
          >
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={dash}
              strokeLinecap={geo.arrow ? undefined : "round"}
              markerEnd={geo.arrow ? "url(#edge-arrow)" : undefined}
            />
            {/* dash-flow overlay while the chain is active; one-shot pulse on completion */}
            {(inChain || pulsing) && (
              <path
                d={d}
                fill="none"
                stroke={overlayStroke}
                strokeWidth={1.5}
                strokeLinecap="round"
                className={pulsing ? "edge-pulse" : "edge-flow"}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
