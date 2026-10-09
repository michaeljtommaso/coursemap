import { useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { placementToEngineSlot, type BoardColumn } from "@/lib/planner/board";
import { usePlannerStore } from "@/store/usePlannerStore";
import { dragState } from "@/lib/drag/dragState";
import { SlotCard } from "@/components/roadmap/SlotCard";
import { columnCredits, formatCredits, semesterLabel } from "@/lib/planner/semesters";
import {
  isSemesterOverloaded,
  MAX_SEMESTER_CREDITS,
  type SlotStatus,
} from "@/lib/planner/computeSlotStatusMap";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * SemesterColumn (spec 004 §1; spec 014 §D1 placement model) — one real DOM
 * column per semester: sticky header, the column's placed course cards in
 * order, an "+ Add a class" affordance, and a live credit footer.
 *
 * Drop target (spec 014 §D4): the whole column (data-column) is hit-tested by
 * dragState into an insertion point {sem, index}. While a drag hovers this
 * column, a dashed card-sized OUTLINE (data-drop-outline) renders at that
 * index and the cards below make room instantly (no animation this pass); the
 * in-flight card itself is hidden by SlotCard so `index` matches
 * movePlacement's mover-excluded semantics. Click-to-place: an armed course
 * clicked onto the column background appends; onto a card inserts there.
 */

/** "Append to the bottom" for addPlacement/movePlacement's index. */
const APPEND = Number.MAX_SAFE_INTEGER;

/** Fallback for a card missing from the status map (shouldn't happen, but keeps
 *  SlotCard's non-null `slotStatus` contract honest). */
const EMPTY_STATUS: SlotStatus = {
  prereq: null,
  coreq: null,
  offeredOk: null,
  blocked: false,
  unmetPrereqLeaves: [],
  prereqState: null,
  advisoryNotes: [],
  overlaps: [],
  docNotes: [],
  coveredByCredit: null,
};

export function SemesterColumn({
  column,
  engineSlotById,
  enteringYear,
  statusMap,
  registerRef,
  onChainHover,
  onCompleted,
  attribution,
}: {
  column: BoardColumn;
  /** useBoard's engine slots by placement id (same objects the engines read). */
  engineSlotById: Map<string, ProgramSlotWithData>;
  enteringYear: number | null;
  statusMap: Record<string, SlotStatus>;
  /** No longer read: the header and footer share columnCredits (B2), whose
   *  min equals this engine total by construction (semesters.test.ts). Kept
   *  optional so RoadmapCanvas compiles unchanged; drop it there next edit. */
  semesterCredits?: Map<number, number>;
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  onChainHover: (slotId: string | null) => void;
  onCompleted: (slotId: string) => void;
  /** placementId → requirement labels it counts toward (useRequirementProgress). */
  attribution: Record<string, string[]>;
}) {
  const label = semesterLabel(column.sem, enteringYear);
  const { completedIds, addPlacement } = usePlan();
  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const disarm = usePlannerStore((s) => s.disarm);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);

  // The hovered insertion index in THIS column (-1 = not hovered), and the
  // in-flight board card (excluded from the index count, hidden by SlotCard).
  const dropIndex = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    return s && s.phase === "dragging" && s.over?.sem === column.sem ? s.over.index : -1;
  });
  const moverId = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    return s && s.phase === "dragging" ? s.sourcePlacementId : null;
  });
  const isDropColumn = dropIndex >= 0;

  const doneCount = useMemo(() => {
    const completed = new Set(completedIds);
    return column.cards.filter(({ placement }) => completed.has(placement.id)).length;
  }, [column.cards, completedIds]);

  // ONE credit total for the header chip AND the footer (B2 — they used to be
  // two computations that disagreed). `min` is the credits_min sum the engine's
  // semesterCredits measures the overload cap against; `max` adds
  // variable-credit headroom, so both surfaces read e.g. "4–7".
  const credits = useMemo(
    () => columnCredits(column.cards.map((c) => c.course)),
    [column.cards]
  );
  const creditMin = credits.min;
  const creditMax = credits.max;
  const creditText = formatCredits(credits) ?? "0";

  const allDone = column.cards.length > 0 && doneCount === column.cards.length;

  // Overload is measured on the credits_min floor (spec 006 §B.3) so an "up to
  // N credits" course never false-positives. In-progress courses do NOT change
  // the done-count above (done = completed).
  const overloaded = isSemesterOverloaded(creditMin);

  const footerRef = useRef<HTMLDivElement>(null);
  const wasAllDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasAllDone.current && footerRef.current) {
      footerRef.current.classList.remove("bloom");
      void footerRef.current.offsetWidth;
      footerRef.current.classList.add("bloom");
    }
    wasAllDone.current = allDone;
  }, [allDone]);

  // + Add a class: an armed course lands at the bottom of this column
  // (click-to-place, spec 004 §4); otherwise open the catalog to pick one.
  const handleAdd = () => {
    if (armedCourse) {
      addPlacement(armedCourse, column.sem, APPEND);
      disarm();
    } else {
      requestCatalogSearch("");
    }
  };

  // Click-to-place onto the column background (not a card, not a button):
  // the armed course goes to the bottom of this column.
  const handleColumnClick = (e: React.MouseEvent) => {
    if (!armedCourse) return;
    if ((e.target as Element).closest("[data-placement], button, [role='menu']")) return;
    addPlacement(armedCourse, column.sem, APPEND);
    disarm();
  };

  // Cards interleaved with the insertion outline. Positions count the cards
  // OTHER than the in-flight one (its node stays mounted, hidden).
  const outline = (
    <div
      key="__drop-outline"
      data-drop-outline
      data-drop-sem={column.sem}
      data-drop-index={dropIndex}
      aria-hidden="true"
      className="min-h-[104px] w-full shrink-0 rounded-lg border-2 border-dashed border-drop bg-drop-tint"
    />
  );
  const cardNodes: React.ReactNode[] = [];
  let visibleIdx = 0;
  for (const card of column.cards) {
    const isMover = card.placement.id === moverId;
    if (!isMover && visibleIdx === dropIndex) cardNodes.push(outline);
    if (!isMover) visibleIdx++;
    const slot =
      engineSlotById.get(card.placement.id) ??
      placementToEngineSlot(card.placement, card.course);
    cardNodes.push(
      <SlotCard
        key={card.placement.id}
        slot={slot}
        slotStatus={statusMap[card.placement.id] ?? EMPTY_STATUS}
        registerRef={registerRef}
        onChainHover={onChainHover}
        onCompleted={onCompleted}
        attribution={attribution[card.placement.id]}
      />
    );
  }
  if (isDropColumn && dropIndex >= visibleIdx) cardNodes.push(outline);

  const load: "light" | "ok" | "heavy" =
    creditMax < 12 ? "light" : creditMin > 18 ? "heavy" : "ok";

  return (
    <div
      data-column={column.sem}
      onClick={handleColumnClick}
      className={cn(
        "flex w-[216px] shrink-0 flex-col rounded-lg transition-shadow",
        isDropColumn && "ring-2 ring-drop ring-offset-2 ring-offset-canvas",
        armedCourse && "cursor-pointer"
      )}
    >
      {/* Sticky header — solid canvas band so cards slide beneath it */}
      <div className="sticky top-0 z-20 -mx-1 bg-canvas px-1 pb-2 pt-1">
        <div className="flex items-baseline justify-between rounded-lg border border-line bg-surface/70 px-2.5 py-1.5">
          <div className="flex flex-col">
            <span className="t-label text-ink-2">
              {enteringYear ? (
                <>
                  {label.primary.split(" ")[0]}{" "}
                  <span className="num">{label.calendarYear}</span>
                </>
              ) : (
                label.primary
              )}
            </span>
            <span className="t-meta">{label.yearWord}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {creditMax > 0 && (
              <span
                className={cn(
                  "rounded px-1 t-meta",
                  overloaded ? "bg-available-tint font-medium text-available-text" : "text-ink-4"
                )}
                title={
                  overloaded
                    ? `${creditText} credits — over the ${MAX_SEMESTER_CREDITS}-credit cap most students stay under`
                    : `${creditText} credits this semester`
                }
              >
                <span className="num">{creditText}</span> cr
              </span>
            )}
            <span className="t-meta text-ink-4">
              Sem <span className="num">{label.sem}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Cards — pt keeps a hovered first card (translateY(-3px) lift) clear of
          the sticky header's opaque canvas band, which would otherwise paint
          over its top edge (it sits at z-20 above the cards by design). */}
      <div className="flex flex-1 flex-col gap-2.5 pb-2 pt-1.5">
        {cardNodes}

        {/* + Add a class — armed course lands here directly (spec 004 §4) */}
        <button
          onClick={handleAdd}
          className={cn(
            "flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-line/80 t-meta text-ink-4",
            // No opacity dimming (B4): at 60% no ink token passes WCAG AA; the
            // quiet look comes from text-ink-4 (AA-raised) + the dashed border.
            "transition-colors hover:border-ink-3 hover:text-ink-2",
            armedCourse && "border-drop text-drop-text"
          )}
          aria-label={
            armedCourse
              ? `Add ${armedCourse.subject} ${armedCourse.number} to this semester`
              : "Find a class to add to this semester"
          }
        >
          <Plus className="h-3 w-3" />
          {armedCourse
            ? `Add ${armedCourse.subject} ${armedCourse.number} here`
            : "Add a class"}
        </button>
      </div>

      {/* Credit footer */}
      <div
        ref={footerRef}
        className={cn(
          "mt-auto rounded-md border border-transparent px-2.5 py-1.5 transition-colors",
          allDone && "border-complete/40 bg-complete-tint"
        )}
      >
        {allDone ? (
          <p className="t-label text-complete-text">Semester complete</p>
        ) : column.cards.length === 0 ? (
          <p className="t-meta text-ink-4">Nothing planned yet.</p>
        ) : (
          <p
            className="t-meta"
            title={
              load === "light"
                ? "A light load — most students carry 12–18 credits."
                : load === "heavy"
                  ? "That's a heavy load — most students stay under 18 credits."
                  : "A healthy load."
            }
          >
            <span
              className={cn(
                "num",
                load === "light" && "text-available-text",
                load === "heavy" && "text-destructive-text"
              )}
            >
              {creditText}
            </span>{" "}
            credits planned
          </p>
        )}
      </div>
    </div>
  );
}
