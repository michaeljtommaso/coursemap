import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { unscaleRect, type Rect } from "@/lib/canvas/zoom";
import { selectUnlockGhosts } from "@/lib/planner/unlockGhosts";
import { unlockCount, type UnlocksMap } from "@/lib/planner/unlocks";
import { recordToCourse, useCatalogContext } from "@/contexts/CatalogProvider";
import { usePlan } from "@/hooks/usePlan";
import { prefersReducedMotion } from "@/lib/motion";
import type { Placement } from "@/lib/planner/deriveEdges";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * UnlocksGhosts (spec 008 §3b/§3c, Unit 8C) — the discovery half of the living
 * graph. Hovering a placed course reveals, to the RIGHT of its card, a cluster
 * of dimmed "ghost" chips for the courses it unlocks that aren't on the plan
 * yet; clicking one pins the real course into a sensible next semester.
 *
 * Mounted INSIDE RoadmapCanvas's zoomed content div (a sibling of EdgeLayer) so
 * it shares the same content-space coordinate system — the hovered card is
 * measured through the SAME registry + unscaleRect EdgeLayer uses.
 *
 * Hover lifecycle (spec 008 §3b): the cluster follows RoadmapCanvas's existing
 * `hoverSlotId` (NOT the store) with a 200ms grace on hover-out so the pointer
 * can travel from card to cluster; hovering the cluster itself re-asserts the
 * anchor hover (via onSustainHover) so it sustains AND keeps the backward chain
 * lit. Reduced motion → no entrance animation.
 *
 * KNOWN DATA GATE (spec 008 §6): live catalog index records lack `unlocks`
 * until a gated re-index, so against live data this cluster shows nothing. The
 * derived PLACED edges work today; the ghosts light up once the index carries
 * unlocks.
 */

const MAX_VISIBLE = 6;
const GAP_X = 28; // space between the hovered card and the cluster (content px)
const CLUSTER_W = 184;
const CHIP_H = 46;
const CHIP_GAP = 6;
const GRACE_MS = 200;

type ResolvedHover = {
  slotId: string;
  courseId: string;
  courseNumber: string;
  semester: number;
};

export function UnlocksGhosts({
  hoverSlotId,
  placements,
  registry,
  contentEl,
  scale,
  layoutVersion,
  unlocksMap,
  recordById,
  onSustainHover,
}: {
  hoverSlotId: string | null;
  placements: Placement[];
  registry: Map<string, HTMLElement>;
  contentEl: HTMLElement | null;
  scale: number;
  layoutVersion: number;
  unlocksMap: UnlocksMap;
  recordById: Map<string, CatalogIndexRecord>;
  /** Re-assert (or clear) RoadmapCanvas's hoverSlotId so hovering the cluster
   *  counts as still hovering the anchor slot (keeps the chain lit + sustains). */
  onSustainHover: (slotId: string | null) => void;
}) {
  // ── Anchor + 200ms grace (keeps the cluster alive across the card→cluster gap) ──
  const [anchorSlotId, setAnchorSlotId] = useState<string | null>(null);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (graceRef.current) {
      clearTimeout(graceRef.current);
      graceRef.current = null;
    }
    if (hoverSlotId) {
      // rAF-defer (imperceptible) so the state write isn't synchronous in the
      // effect body — matches EdgeLayer's measure pattern.
      const raf = requestAnimationFrame(() => setAnchorSlotId(hoverSlotId));
      return () => cancelAnimationFrame(raf);
    }
    // Grace: keep the anchor for 200ms so the pointer can travel card → cluster.
    graceRef.current = setTimeout(() => setAnchorSlotId(null), GRACE_MS);
    return () => {
      if (graceRef.current) clearTimeout(graceRef.current);
    };
  }, [hoverSlotId]);

  // ── Resolve the hovered placed course (id, number, semester) from placements ──
  const resolved = useMemo<ResolvedHover | null>(() => {
    if (!anchorSlotId) return null;
    const p = placements.find((pl) => pl.slotId === anchorSlotId);
    if (!p) return null;
    return {
      slotId: p.slotId,
      courseId: p.course.id,
      courseNumber: p.course.number,
      semester: p.semester,
    };
  }, [anchorSlotId, placements]);

  const placedCourseIds = useMemo(
    () => new Set(placements.map((p) => p.course.id)),
    [placements]
  );

  const ghosts = useMemo<CatalogIndexRecord[]>(() => {
    if (!resolved) return [];
    const unlocks = unlocksMap.get(resolved.courseId);
    if (!unlocks || unlocks.length === 0) return [];
    return selectUnlockGhosts(
      unlocks,
      { id: resolved.courseId, number: resolved.courseNumber },
      placedCourseIds,
      recordById
    );
  }, [resolved, unlocksMap, placedCourseIds, recordById]);

  // ── Measure the hovered card (content-space, same math as EdgeLayer) ──
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  useEffect(() => {
    // rAF-defer the measure/write (EdgeLayer's pattern) so the state set isn't
    // synchronous in the effect body. layoutVersion re-measures on register.
    const raf = requestAnimationFrame(() => {
      const el = contentEl && anchorSlotId ? registry.get(anchorSlotId) : null;
      if (!contentEl || !el) {
        setAnchorRect(null);
        return;
      }
      const base = contentEl.getBoundingClientRect();
      setAnchorRect(unscaleRect(el.getBoundingClientRect(), base, scale));
    });
    return () => cancelAnimationFrame(raf);
  }, [anchorSlotId, contentEl, registry, scale, layoutVersion]);

  if (!resolved || !anchorRect || ghosts.length === 0) return null;

  const left = anchorRect.x + anchorRect.w + GAP_X;
  const top = anchorRect.y;

  return (
    <UnlocksCluster
      key={anchorSlotId ?? "none"}
      left={left}
      top={top}
      anchorHeight={anchorRect.h}
      ghosts={ghosts}
      hoveredSemester={resolved.semester}
      unlocksMap={unlocksMap}
      onSustainHover={() => onSustainHover(resolved.slotId)}
      onReleaseHover={() => onSustainHover(null)}
    />
  );
}

/** The positioned cluster. Keyed by anchor slot in the parent so it remounts —
 *  resetting the "+N more" expansion and the entrance animation — per hover. */
function UnlocksCluster({
  left,
  top,
  anchorHeight,
  ghosts,
  hoveredSemester,
  unlocksMap,
  onSustainHover,
  onReleaseHover,
}: {
  left: number;
  top: number;
  anchorHeight: number;
  ghosts: CatalogIndexRecord[];
  hoveredSemester: number;
  unlocksMap: UnlocksMap;
  onSustainHover: () => void;
  onReleaseHover: () => void;
}) {
  const { ensureCourseDetails } = useCatalogContext();
  const { addCustomSlot, assignSlot } = usePlan();
  const reduce = prefersReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [shown, setShown] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [reduce]);

  const overflow = ghosts.length - MAX_VISIBLE;
  const visible = expanded ? ghosts : ghosts.slice(0, MAX_VISIBLE);

  const handlePin = (rec: CatalogIndexRecord) => {
    // A ghost tap is a NORMAL placement — nothing ghost-specific persists.
    const course = recordToCourse(rec);
    const sem = Math.min(hoveredSemester + 1, 10);
    const id = addCustomSlot(sem);
    assignSlot(id, course);
    // Fetch the real tree so derived edges + status upgrade on the next render.
    ensureCourseDetails([course.id]);
  };

  // Connector origin: the card's right-middle, GAP_X to the left of the cluster.
  const originX = -GAP_X;
  const originY = anchorHeight / 2;

  return (
    <div
      className="absolute z-10"
      style={{
        left,
        top,
        width: CLUSTER_W,
        opacity: shown ? 1 : 0,
        transform: shown ? "translateX(0)" : "translateX(-4px)",
        transition: reduce ? undefined : "opacity 140ms ease, transform 140ms ease",
      }}
      // Hovering the cluster sustains the anchor hover (spec 008 §3b).
      onMouseEnter={onSustainHover}
      onMouseLeave={onReleaseHover}
    >
      {/* Own ghost connectors — the cluster draws its OWN lines from the card's
          right edge to each visible chip. Decoupled from EdgeLayer by design;
          full cross-canvas ghost wiring is a possible later refinement. */}
      {!expanded && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {visible.map((_, i) => {
            const chipCenterY = i * (CHIP_H + CHIP_GAP) + CHIP_H / 2;
            const dx = Math.abs(originX) * 0.5;
            const d = `M ${originX} ${originY} C ${originX + dx} ${originY}, ${-dx} ${chipCenterY}, 0 ${chipCenterY}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="2 4"
                opacity={0.5}
              />
            );
          })}
        </svg>
      )}

      <div
        className={
          expanded
            ? "flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-0.5"
            : "flex flex-col gap-1.5"
        }
      >
        {visible.map((rec) => (
          <GhostChip key={rec.id} rec={rec} unlocksMap={unlocksMap} onPin={handlePin} />
        ))}

        {overflow > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded-md border border-dashed border-line-strong/70 bg-surface/40 px-2 py-1 t-meta text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
          >
            {expanded ? "Show fewer" : `+${overflow} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** One dimmed, dashed ghost chip — clearly not a real card. Focusable, role
 *  button, Enter/click pins the course (spec 008 §3b). */
function GhostChip({
  rec,
  unlocksMap,
  onPin,
}: {
  rec: CatalogIndexRecord;
  unlocksMap: UnlocksMap;
  onPin: (rec: CatalogIndexRecord) => void;
}) {
  const code = `${rec.subject} ${rec.number}`;
  const n = unlockCount(unlocksMap, rec.id);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Add ${code} to your plan`}
      onClick={() => onPin(rec)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPin(rec);
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ minHeight: CHIP_H }}
      className="group/ghost flex cursor-pointer flex-col justify-center gap-0.5 rounded-md border border-dashed border-line-strong/70 bg-surface/50 px-2.5 py-1.5 text-left opacity-80 shadow-sm outline-none transition-all hover:border-drop hover:bg-drop-tint/40 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="num truncate text-[10px] font-bold uppercase tracking-[.06em] text-ink-2">
          {code}
        </span>
        <span className="flex flex-none items-center gap-0.5 text-ink-4 opacity-0 transition-opacity group-hover/ghost:opacity-100">
          <Plus className="h-2.5 w-2.5" />
        </span>
      </div>
      <span className="line-clamp-1 t-meta text-ink-3">{rec.title}</span>
      <span className="num text-[8.5px] text-ink-4">
        {rec.creditsMin === rec.creditsMax ? rec.creditsMin : `${rec.creditsMin}–${rec.creditsMax}`} cr
        {n > 0 ? ` · unlocks ${n}` : ""}
      </span>
    </div>
  );
}
