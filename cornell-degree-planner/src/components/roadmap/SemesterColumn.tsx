import { useMemo, useRef, useEffect, useState, useSyncExternalStore } from "react";
import { Plus, RotateCcw, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { dragState } from "@/lib/drag/dragState";
import { SlotCard } from "@/components/roadmap/SlotCard";
import {
  semesterLabel,
  slotCredits,
  type SemesterGroup,
} from "@/lib/planner/semesters";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * SemesterColumn (spec 004 §1 + 005 §9) — one real DOM column per semester:
 * sticky header (with the hidden-slots restore chip), auto-height cards, an
 * "+ Add a class" ghost card, and a live credit footer. The column body is a
 * drop target (data-column) for slot moves and course re-homing.
 */

export function SemesterColumn({
  group,
  hidden,
  enteringYear,
  prereqStatusMap,
  registerRef,
  onChainHover,
  onCompleted,
}: {
  group: SemesterGroup;
  hidden: ProgramSlotWithData[];
  enteringYear: number | null;
  prereqStatusMap: Record<string, boolean | null>;
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  onChainHover: (slotId: string | null) => void;
  onCompleted: (slotId: string) => void;
}) {
  const label = semesterLabel(group.sem, enteringYear);
  const {
    completedSlotIds,
    waivedSlotIds,
    slotSelections,
    selectedCourses,
    addCustomSlot,
    assignSlot,
    restoreSlot,
  } = usePlan();
  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const disarm = usePlannerStore((s) => s.disarm);

  // Column lights up while a drag hovers its background (slot move / re-home).
  const isDropColumn = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.overColumnSem === group.sem && !dragState.get()?.overSlotId
  );

  const [restoreOpen, setRestoreOpen] = useState(false);
  useEffect(() => {
    if (hidden.length === 0) setRestoreOpen(false);
  }, [hidden.length]);

  const { creditMin, creditMax, doneCount } = useMemo(() => {
    let min = 0;
    let max = 0;
    let done = 0;
    for (const slot of group.slots) {
      if (completedSlotIds.includes(slot.id) || waivedSlotIds.includes(slot.id)) done++;
      const placedId = slotSelections[slot.id];
      const placed = placedId ? (selectedCourses[placedId] ?? null) : null;
      const cr = slotCredits(slot, placed);
      if (cr) {
        min += cr.min;
        max += cr.max;
      }
    }
    return { creditMin: min, creditMax: max, doneCount: done };
  }, [group.slots, completedSlotIds, waivedSlotIds, slotSelections, selectedCourses]);

  const allDone = group.slots.length > 0 && doneCount === group.slots.length;

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

  const handleAdd = () => {
    if (armedCourse) {
      const id = addCustomSlot(group.sem);
      assignSlot(id, armedCourse);
      disarm();
    } else {
      addCustomSlot(group.sem);
    }
  };

  const creditText =
    creditMin === creditMax ? `${creditMin}` : `${creditMin}–${creditMax}`;
  const load: "light" | "ok" | "heavy" =
    creditMax < 12 ? "light" : creditMin > 18 ? "heavy" : "ok";

  return (
    <div
      data-column={group.sem}
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
            {hidden.length > 0 && (
              <button
                onClick={() => setRestoreOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 t-meta text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
                aria-expanded={restoreOpen}
                aria-label={`${hidden.length} hidden ${hidden.length === 1 ? "slot" : "slots"} — restore`}
                title="Slots you removed from this semester"
              >
                <EyeOff className="h-2.5 w-2.5" />
                <span className="num">{hidden.length}</span>
              </button>
            )}
            <span className="t-meta text-ink-4">
              Sem <span className="num">{label.sem}</span>
            </span>
          </div>
        </div>

        {/* Restore list */}
        {restoreOpen && hidden.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-md">
            <p className="px-1 t-meta">Removed from this semester:</p>
            {hidden.map((s) => {
              const name =
                s.kind === "course" && s.courses
                  ? `${s.courses.subject} ${s.courses.number}`
                  : s.elective_groups?.name ?? s.pattern_title ?? s.pattern ?? "Slot";
              return (
                <button
                  key={s.id}
                  onClick={() => restoreSlot(s.id)}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left t-meta text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <RotateCcw className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2.5 pb-2">
        {group.slots.map((slot) => (
          <SlotCard
            key={slot.id}
            slot={slot}
            prereqStatus={prereqStatusMap[slot.id] ?? null}
            registerRef={registerRef}
            onChainHover={onChainHover}
            onCompleted={onCompleted}
          />
        ))}

        {/* + Add a class — armed course lands here directly (spec 005 §9) */}
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
              : "Add a class slot to this semester"
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
        ) : group.slots.length === 0 ? (
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
