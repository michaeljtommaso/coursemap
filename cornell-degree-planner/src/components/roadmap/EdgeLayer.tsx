import { useLayoutEffect, useMemo, useState } from "react";
import type { SlotEdge } from "@/types/db";
import type { SlotStatus } from "@/lib/planner/computeSlotStatusMap";
import { unscaleRect } from "@/lib/canvas/zoom";

/**
 * EdgeLayer (spec 004 §1 + overnight brief) — the prereq "wires" between cards.
 *
 * Geometry: cards are real DOM nodes in CSS-grid columns; this layer measures
 * them relative to the canvas CONTENT element (both scroll together, so the
 * coordinates are scroll-independent) via a ref registry + one ResizeObserver.
 *
 * Semantics match the official Cornell flowcharts (docs/reference/flowcharts):
 *   prereq      → solid line, arrowhead
 *   coreq       → double line (wide stroke + canvas-colored core), arrowhead
 *   concurrent  → dashed line, arrowhead
 *
 * Interaction ("how classes talk to each other"):
 *   - Hovering/focusing a card lifts its FULL chain (ancestors + descendants):
 *     chain edges darken and carry a slow dash-flow; unrelated edges recede.
 *   - Completing a course fires a one-shot pulse down its outgoing edges.
 *   - All motion is CSS keyframes, disabled under prefers-reduced-motion.
 *
 * State-awareness (spec 006 §B.3): the optional `statusMap` prop (from
 * `computeSlotStatusMap`) lets an edge whose TARGET slot is blocked render in
 * the destructive/red token instead of the normal ink. This is a pure
 * draw-time color decision — no extra state, no per-frame work — so it costs
 * nothing when `statusMap` is omitted (behavior is then byte-for-byte the
 * pre-existing one). Blocked edges keep the red treatment even inside an
 * active hover-chain: the flowing "current" overlay tints red too (instead of
 * the neutral `--text` ink) so an unmet wire stays legible as "still broken"
 * while it's being traced, rather than reading as healthy just because it's
 * part of the highlighted chain.
 */

export type EdgePulse = { slotId: string; key: number } | null;

type Rect = { x: number; y: number; w: number; h: number };

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
function chainEdges(edges: SlotEdge[], from: string | null): Set<string> {
  const result = new Set<string>();
  if (!from) return result;
  const up = new Map<string, SlotEdge[]>(); // to_slot → edges
  const down = new Map<string, SlotEdge[]>(); // from_slot → edges
  for (const e of edges) {
    (down.get(e.from_slot) ?? down.set(e.from_slot, []).get(e.from_slot)!).push(e);
    (up.get(e.to_slot) ?? up.set(e.to_slot, []).get(e.to_slot)!).push(e);
  }
  const walk = (start: string, dir: "up" | "down") => {
    const queue = [start];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of (dir === "down" ? down : up).get(cur) ?? []) {
        result.add(e.id);
        queue.push(dir === "down" ? e.to_slot : e.from_slot);
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
  statusMap,
}: {
  edges: SlotEdge[];
  registry: Map<string, HTMLElement>;
  contentEl: HTMLElement | null;
  /** Bumped whenever a card registers/unregisters, to trigger re-measure. */
  layoutVersion: number;
  /** Canvas zoom factor (spec 006 §F2). Rect deltas are divided by it so arrows
   *  stay aligned when the content is scaled. Defaults to 1 (no zoom). */
  scale?: number;
  hoverSlotId: string | null;
  pulse: EdgePulse;
  /** Optional (spec 006 §B.3). slotId → evaluated status. When omitted, edge
   *  coloring is exactly the pre-state-aware behavior. When present, an edge
   *  whose TARGET slot is blocked draws in the destructive token. */
  statusMap?: Record<string, SlotStatus>;
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
    return new Set(edges.filter((e) => e.from_slot === pulse.slotId).map((e) => e.id));
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
        const from = rects.get(edge.from_slot);
        const to = rects.get(edge.to_slot);
        if (!from || !to) return null;

        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x - 2; // breathe before the arrowhead
        const y2 = to.y + to.h / 2;
        const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        const inChain = activeChain.has(edge.id);
        const pulsing = pulseEdges.has(edge.id);
        const type =
          edge.edge_type === "prereq"
            ? "prereq"
            : edge.edge_type === "concurrent"
              ? "concurrent"
              : "coreq";

        // Rest → chain-active → receded opacities. Blocked state (when
        // statusMap is supplied) doesn't change opacity, only color — a
        // blocked edge outside the active chain still recedes like any other.
        const baseOpacity = hasChain ? (inChain ? 1 : 0.1) : 0.55;
        const isBlocked = statusMap?.[edge.to_slot]?.blocked === true;
        const stroke = isBlocked
          ? "var(--destructive)"
          : inChain
            ? "var(--text-3)"
            : "var(--border-strong)";
        // The flowing-current / pulse overlay is normally neutral ink
        // (`--text`) so it reads as "energy moving," not a status color. For
        // a blocked edge we keep that overlay red too, so the red base wire
        // never gets neutralized to ink while it's part of the highlighted
        // chain — an unmet prereq stays visibly red throughout the animation.
        const overlayStroke = isBlocked ? "var(--destructive)" : "var(--text)";

        return (
          <g key={edge.id} style={{ opacity: baseOpacity, transition: "opacity 180ms ease" }}>
            {type === "coreq" ? (
              <>
                {/* double line: wide stroke + canvas-colored core */}
                <path d={d} fill="none" stroke={stroke} strokeWidth={4} markerEnd="url(#edge-arrow)" />
                <path d={d} fill="none" stroke="var(--canvas)" strokeWidth={1.8} />
              </>
            ) : (
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray={type === "concurrent" ? "4 4" : undefined}
                markerEnd="url(#edge-arrow)"
              />
            )}
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
