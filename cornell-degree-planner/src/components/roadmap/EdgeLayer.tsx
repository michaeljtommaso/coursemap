import { useLayoutEffect, useMemo, useState } from "react";
import type { DerivedEdge } from "@/lib/planner/deriveEdges";
import { unscaleRect } from "@/lib/canvas/zoom";

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
 * Visual language by kind:
 *   prereq      → solid line + arrowhead
 *   concurrent  → dashed line ("4 4") + arrowhead. NOTE: the old authored
 *                 `coreq` double-line RETIRES with authored edges — there is one
 *                 concurrent visual language now (spec 008 §2c).
 *   advisory    → dashed with a wider gap ("2 6"), reduced base opacity (×0.7),
 *                 and NEVER red regardless of state — an advisory never blocks
 *                 (spec 007 honesty rule).
 * Color by state: a prereq/concurrent edge whose feeder is NOT strictly/at-or-
 * earlier than its dependent is `state: "violated"` → drawn in --destructive.
 * Satisfied edges use the neutral scheme (in-chain --text-3, else --border-strong).
 *
 * Interaction ("how classes talk to each other"):
 *   - Hovering/focusing a card lifts its FULL chain (ancestors + descendants):
 *     chain edges darken and carry a slow dash-flow; unrelated edges recede.
 *   - Completing a course fires a one-shot pulse down its outgoing edges.
 *   - All motion is CSS keyframes, disabled under prefers-reduced-motion.
 */

export type EdgePulse = { slotId: string; key: number } | null;

type Rect = { x: number; y: number; w: number; h: number };

/** Stable synthetic id for chain sets / pulse matching (edges carry no id). */
function edgeId(e: DerivedEdge): string {
  return `${e.fromSlotId}>${e.toSlotId}:${e.kind}`;
}

function measure(
  registry: Map<string, HTMLElement>,
  contentEl: HTMLElement,
  scale: number
): Map<string, Rect> {
  const base = contentEl.getBoundingClientRect();
  const out = new Map<string, Rect>();
  for (const [id, el] of registry) {
    // getBoundingClientRect is transform-affected; the content is scaled with
    // origin top-left, so dividing the (rect − base) delta AND the size by the
    // zoom recovers the content-space coordinates the SVG draws in. At scale 1
    // this is a pass-through — byte-for-byte the pre-zoom behavior (spec §F2).
    out.set(id, unscaleRect(el.getBoundingClientRect(), base, scale));
  }
  return out;
}

/** BFS the chain (both directions) from a slot; returns the edge keys involved. */
function chainEdges(edges: DerivedEdge[], from: string | null): Set<string> {
  const result = new Set<string>();
  if (!from) return result;
  const up = new Map<string, DerivedEdge[]>(); // toSlotId → edges
  const down = new Map<string, DerivedEdge[]>(); // fromSlotId → edges
  for (const e of edges) {
    (down.get(e.fromSlotId) ?? down.set(e.fromSlotId, []).get(e.fromSlotId)!).push(e);
    (up.get(e.toSlotId) ?? up.set(e.toSlotId, []).get(e.toSlotId)!).push(e);
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
        queue.push(dir === "down" ? e.toSlotId : e.fromSlotId);
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
  hoverSlotId,
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
  hoverSlotId: string | null;
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

  const activeChain = useMemo(() => chainEdges(edges, hoverSlotId), [edges, hoverSlotId]);
  const hasChain = activeChain.size > 0;
  const pulseEdges = useMemo(() => {
    if (!pulse) return new Set<string>();
    return new Set(edges.filter((e) => e.fromSlotId === pulse.slotId).map(edgeId));
  }, [edges, pulse]);

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
        const from = rects.get(edge.fromSlotId);
        const to = rects.get(edge.toSlotId);
        if (!from || !to) return null;

        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x - 2; // breathe before the arrowhead
        const y2 = to.y + to.h / 2;
        const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        const inChain = activeChain.has(id);
        const pulsing = pulseEdges.has(id);

        // Advisory NEVER blocks (spec 007) — it can never render red even when
        // its feeder sits later than its dependent. Only prereq/concurrent go
        // red on a violated semester ordering (the edge's own state IS the truth).
        const violated = edge.state === "violated" && edge.kind !== "advisory";
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
        const dash = isAdvisory ? "2 6" : edge.kind === "concurrent" ? "4 4" : undefined;

        return (
          <g key={id} style={{ opacity: baseOpacity, transition: "opacity 180ms ease" }}>
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={dash}
              markerEnd="url(#edge-arrow)"
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
