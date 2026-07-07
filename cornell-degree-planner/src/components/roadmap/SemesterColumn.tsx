import { useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { SlotCard } from "@/components/roadmap/SlotCard";
import {
  semesterLabel,
  slotCredits,
  type SemesterGroup,
} from "@/lib/planner/semesters";

/**
 * SemesterColumn (spec 004 §1) — one real DOM column per semester: a sticky
 * header (you always know where you are mid-scroll), auto-height slot cards,
 * and a live credit footer (12–18 cr is the healthy band; the footer whispers,
 * never shouts). When every slot in the semester is completed the footer
 * quietly celebrates — one tint bloom, no confetti.
 */

export function SemesterColumn({
  group,
  enteringYear,
  prereqStatusMap,
  registerRef,
  onChainHover,
  onCompleted,
}: {
  group: SemesterGroup;
  enteringYear: number | null;
  prereqStatusMap: Record<string, boolean | null>;
  registerRef: (slotId: string, el: HTMLElement | null) => void;
  onChainHover: (slotId: string | null) => void;
  onCompleted: (slotId: string) => void;
}) {
  const label = semesterLabel(group.sem, enteringYear);
  const { completedSlotIds, waivedSlotIds, slotSelections, selectedCourses } = usePlan();

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

  // One quiet bloom the moment the semester completes.
  const footerRef = useRef<HTMLDivElement>(null);
  const wasAllDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasAllDone.current && footerRef.current) {
      footerRef.current.classList.remove("bloom");
      // restart the CSS animation
      void footerRef.current.offsetWidth;
      footerRef.current.classList.add("bloom");
    }
    wasAllDone.current = allDone;
  }, [allDone]);

  const creditText =
    creditMin === creditMax ? `${creditMin}` : `${creditMin}–${creditMax}`;
  const load: "light" | "ok" | "heavy" =
    creditMax < 12 ? "light" : creditMin > 18 ? "heavy" : "ok";

  return (
    <div className="flex w-[216px] shrink-0 flex-col">
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
          <span className="t-meta text-ink-4">
            Sem <span className="num">{label.sem}</span>
          </span>
        </div>
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
