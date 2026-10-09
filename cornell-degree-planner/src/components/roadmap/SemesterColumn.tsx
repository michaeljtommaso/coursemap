import { useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { placementToEngineSlot, type BoardColumn } from "@/lib/planner/board";
import { usePlannerStore } from "@/store/usePlannerStore";
import { dragState } from "@/lib/drag/dragState";
import { SlotCard } from "@/components/roadmap/SlotCard";
import { semesterLabel } from "@/lib/planner/semesters";
import {
  isSemesterOverloaded,
  MAX_SEMESTER_CREDITS,
  type SlotStatus,
} from "@/lib/planner/computeSlotStatusMap";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * SemesterColumn (spec 004 §1; spec 014 §D1 placement model) — one real DOM
 * column per semester: sticky header, the column's placed course cards in
 * order, an "+ Add a class" affordance, and a live credit footer. The column
 * body is a drop target (data-column): a course dropped on its background is
 * appended to the bottom (the drag lane adds positional insertion).
 */

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
};

export function SemesterColumn({
  column,
  engineSlotById,
  enteringYear,
  statusMap,
  semesterCredits,
  registerRef,
  onChainHover,
  onCompleted,
}: {
  column: BoardColumn;
  /** useBoard's engine slots by placement id (same objects the engines read). */
  engineSlotById: Map<string, ProgramSlotWithData>;
  enteringYear: number | null;
  statusMap: Record<string, SlotStatus>;
  semesterCredits: Map<number, number>;
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  onChainHover: (slotId: string | null) => void;
  onCompleted: (slotId: string) => void;
}) {
  const label = semesterLabel(column.sem, enteringYear);
  const { completedIds, addPlacement } = usePlan();
  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const disarm = usePlannerStore((s) => s.disarm);
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);

  // Column lights up while a drag hovers its background.
  const isDropColumn = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.overColumnSem === column.sem && !dragState.get()?.overSlotId
  );

  const { creditMin, creditMax, doneCount } = useMemo(() => {
    let min = 0;
    let max = 0;
    let done = 0;
    const completed = new Set(completedIds);
    for (const { placement, course } of column.cards) {
      if (completed.has(placement.id)) done++;
      min += course.credits_min;
      max += course.credits_max;
    }
    return { creditMin: min, creditMax: max, doneCount: done };
  }, [column.cards, completedIds]);

  const allDone = column.cards.length > 0 && doneCount === column.cards.length;

  // Column credit total straight from the engine (spec 006 §B.3) — the same
  // credits_min-based sum the overload cap is measured against. In-progress
  // courses do NOT change the done-count above (done = completed).
  const engineCredits = semesterCredits.get(column.sem) ?? 0;
  const overloaded = isSemesterOverloaded(engineCredits);

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
      addPlacement(armedCourse, column.sem);
      disarm();
    } else {
      requestCatalogSearch("");
    }
  };

  const creditText =
    creditMin === creditMax ? `${creditMin}` : `${creditMin}–${creditMax}`;
  const load: "light" | "ok" | "heavy" =
    creditMax < 12 ? "light" : creditMin > 18 ? "heavy" : "ok";

  return (
    <div
      data-column={column.sem}
      className={cn(
        "flex w-[216px] shrink-0 flex-col rounded-lg transition-shadow",
        isDropColumn && "ring-2 ring-drop ring-offset-2 ring-offset-canvas"
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
            {engineCredits > 0 && (
              <span
                className={cn(
                  "rounded px-1 t-meta",
                  overloaded ? "bg-available-tint font-medium text-available-text" : "text-ink-4"
                )}
                title={
                  overloaded
                    ? `${engineCredits} credits — over the ${MAX_SEMESTER_CREDITS}-credit cap most students stay under`
                    : `${engineCredits} credits this semester`
                }
              >
                <span className="num">{engineCredits}</span> cr
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
        {column.cards.map((card) => {
          const slot =
            engineSlotById.get(card.placement.id) ??
            placementToEngineSlot(card.placement, card.course);
          return (
            <SlotCard
              key={card.placement.id}
              slot={slot}
              slotStatus={statusMap[card.placement.id] ?? EMPTY_STATUS}
              registerRef={registerRef}
              onChainHover={onChainHover}
              onCompleted={onCompleted}
            />
          );
        })}

        {/* + Add a class — armed course lands here directly (spec 004 §4) */}
        <button
          onClick={handleAdd}
          className={cn(
            "flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-line/80 t-meta text-ink-4",
            "opacity-60 transition-all hover:border-ink-3 hover:text-ink-2 hover:opacity-100",
            armedCourse && "border-drop text-drop-text opacity-100"
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
