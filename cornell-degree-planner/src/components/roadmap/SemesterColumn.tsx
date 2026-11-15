import { useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";
import { withChosenCredits } from "@/lib/planner/chosenCredits";
import type { BoardColumn } from "@/lib/planner/board";
import { termOfColumn } from "@/lib/planner/terms";
import { columnTarget } from "@/components/roadmap/boardColumns";
import { AddShortTermButton } from "@/components/roadmap/AddShortTermButton";
import { usePlannerStore } from "@/store/usePlannerStore";
import { prefersReducedMotion } from "@/lib/motion";
import { dragState } from "@/lib/drag/dragState";
import { useColumnGlide } from "@/hooks/useColumnGlide";
import { CourseCard } from "@/components/roadmap/CourseCard";
import { columnCredits, formatCredits, semesterLabel } from "@/lib/planner/semesters";
import {
  isSemesterOverloaded,
  MAX_SEMESTER_CREDITS,
  type CardStatus,
} from "@/lib/planner/computeCardStatusMap";
import type { PendingChoice } from "@/lib/planner/pendingChoices";
import { Tooltip } from "@/components/ui/Tooltip";
import type { CardProgramInfo } from "./cardPrograms";

const NO_CARD_PROGRAMS: Record<string, CardProgramInfo> = {};

/**
 * SemesterColumn (spec 004 §1; spec 014 §D1 placement model) — one real DOM
 * column per semester: sticky header, the column's placed course cards in
 * order, an "+ Add a class" affordance, and a live credit footer.
 *
 * Drop target (spec 014 §D4): the whole column (data-column) is hit-tested by
 * dragState into an insertion point {sem, index}. While a drag hovers this
 * column, a dashed card-sized OUTLINE (data-drop-outline) renders at that
 * index and the cards below make room; the in-flight card itself is hidden by
 * CourseCard so `index` matches movePlacement's mover-excluded semantics. The
 * layout changes instantly and useColumnGlide animates it (polish plan D1):
 * the cards glide apart, and settle after a drop or removal. Click-to-place:
 * an armed course clicked onto the column background appends; onto a card
 * inserts there.
 *
 * Short terms (spec 042 D6/D7): a column with `shortTerm` is the Winter or
 * Summer just before semester `sem` — same 216px width, a tinted body with a
 * dashed outline, a "SUMMER 2026 · 3 cr" header (no "Sem N", no class-year
 * word, no light/heavy credit bands) and an × that removes it while it is
 * empty (disabled, with a tooltip, while it holds classes).
 *
 * DOM contract (drag + tests): every column carries `data-column-key` (its
 * time key, terms.ts columnKey) — the drag engine hit-tests that. A regular
 * column also carries `data-column={sem}`; a short-term column carries
 * `data-short-term-before={sem}` instead, so `[data-column="N"]` only ever
 * matches semester N.
 */

/** "Append to the bottom" for addPlacement/movePlacement's index. */
const APPEND = Number.MAX_SAFE_INTEGER;

/** Fallback for a card missing from the status map (shouldn't happen, but keeps
 *  CourseCard's non-null `status` contract honest). */
const EMPTY_STATUS: CardStatus = {
  prereq: null,
  coreq: null,
  offeredOk: null,
  blocked: false,
  unmetPrereqLeaves: [],
  unmetCoreqLeaves: [],
  prereqState: null,
  advisoryNotes: [],
  overlaps: [],
  docNotes: [],
  coveredByCredit: null,
};

export function SemesterColumn({
  column,
  enteringYear,
  statusMap,
  pendingChoices,
  registerRef,
  onChainHover,
  onCompleted,
  attribution,
  cardPrograms = NO_CARD_PROGRAMS,
  beforeCountFor,
  canAddShortTermBefore = false,
}: {
  column: BoardColumn;
  enteringYear: number | null;
  statusMap: Record<string, CardStatus>;
  /** placementId → the open choice a blocked card waits on (useCardStatus). */
  pendingChoices: Record<string, PendingChoice>;
  /** No longer read: the header and footer share columnCredits (B2), whose
   *  min equals this engine total by construction (semesters.test.ts). Kept
   *  optional so RoadmapCanvas compiles unchanged; drop it there next edit. */
  semesterCredits?: Map<number, number>;
  registerRef: (placementId: string, el: HTMLElement | null) => void;
  onChainHover: (placementId: string | null) => void;
  onCompleted: (placementId: string) => void;
  /** placementId → requirement labels it counts toward (useRequirementProgress). */
  attribution: Record<string, string[]>;
  /** Spec 047 D6/D8: placementId → its card's program dots and held-back
   *  line (buildCardPrograms); empty without extra programs. */
  cardPrograms?: Record<string, CardProgramInfo>;
  /** Spec 047 D10: handed to each card's "Count it for X instead". */
  beforeCountFor?: (courseId: string, layerId: string) => void;
  /** Spec 042 D2/D8: show the gap "+" before this (regular) column — the gap
   *  has no short term yet and the plan is under the short-term cap. */
  canAddShortTermBefore?: boolean;
}) {
  const isShort = column.shortTerm;
  const label = semesterLabel(column.sem, enteringYear);
  // A short term's name ("Summer 2026", or "Summer" without an entering year).
  const term = termOfColumn(column, enteringYear);
  // What addPlacement takes for this column (a number for a semester).
  const target = columnTarget(column);
  const { completedIds, addPlacement, removeShortTerm, courseMarks } = usePlan();
  const armedCourse = usePlannerStore((s) => s.armedCourse);
  const disarm = usePlannerStore((s) => s.disarm);
  // Spec 017 D6 — "Place on board" for a course on the enrollment-term roster
  // names this column as the suggested target. A signal only: every column
  // still takes the click, and the store clears it on place / disarm / re-arm.
  // The suggestion names an enrollment-term SEMESTER — never a short term.
  const isSuggestedTarget = usePlannerStore(
    (s) => !isShort && s.armedCourse !== null && s.armedHighlightSem === column.sem
  );
  const requestCatalogSearch = usePlannerStore((s) => s.requestCatalogSearch);

  // The hovered insertion index in THIS column (-1 = not hovered), and the
  // in-flight board card (excluded from the index count, hidden by CourseCard).
  // A short-term column and its semester are different targets (spec 042).
  const dropIndex = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    return s &&
      s.phase === "dragging" &&
      s.over?.sem === column.sem &&
      !!s.over.shortTerm === isShort
      ? s.over.index
      : -1;
  });
  const moverId = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    return s && s.phase === "dragging" ? s.sourcePlacementId : null;
  });
  // The dragged card is in this column and hidden (its outline shows the
  // destination): the cards below it close the gap.
  const moverHidden = useSyncExternalStore(dragState.subscribe, () => {
    const s = dragState.get();
    if (!s || s.phase !== "dragging" || s.over === null || !s.sourcePlacementId) return false;
    const id = s.sourcePlacementId;
    return column.cards.some((c) => c.placement.id === id);
  });
  const isDropColumn = dropIndex >= 0;

  // Gliding neighbours (polish plan D1): animate on these changes only.
  const stackRef = useRef<HTMLDivElement>(null);
  const glideTrigger = `${dropIndex}|${moverId ?? ""}|${moverHidden ? 1 : 0}|${column.cards
    .map((c) => c.placement.id)
    .join(",")}`;
  useColumnGlide(stackRef, glideTrigger);

  const doneCount = useMemo(() => {
    const completed = new Set(completedIds);
    return column.cards.filter(({ placement }) => completed.has(placement.id)).length;
  }, [column.cards, completedIds]);

  // ONE credit total for the header chip AND the footer (B2 — they used to be
  // two computations that disagreed). `min` is the credits_min sum the engine's
  // semesterCredits measures the overload cap against; `max` adds
  // variable-credit headroom, so both surfaces read e.g. "4–7".
  const credits = useMemo(
    () => columnCredits(column.cards.map((c) => withChosenCredits(c.course, courseMarks, c.placement.courseId))),
    [column.cards, courseMarks]
  );
  const creditMin = credits.min;
  const creditMax = credits.max;
  const creditText = formatCredits(credits) ?? "0";

  const allDone = column.cards.length > 0 && doneCount === column.cards.length;

  // Overload is measured on the credits_min floor (spec 006 §B.3) so an "up to
  // N credits" course never false-positives. In-progress courses do NOT change
  // the done-count above (done = completed). Fall/Spring only: short terms
  // carry no credit cap or load bands (spec 042 D5).
  const overloaded = isSemesterOverloaded(creditMin, isShort);

  // Bring the suggested column into view once per arm (instant under reduced
  // motion), centred horizontally without yanking the page vertically, then
  // move keyboard focus to its "Add … to this semester" button (without a
  // second scroll) so a keyboard user lands where the course is suggested.
  // Only the suggested arm does this; "Place on board" sets it only when
  // arriving from off the board.
  const columnRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isSuggestedTarget) return;
    columnRef.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    addButtonRef.current?.focus({ preventScroll: true });
  }, [isSuggestedTarget, armedCourse]);

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
      addPlacement(armedCourse, target, APPEND);
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
    addPlacement(armedCourse, target, APPEND);
    disarm();
  };

  // Cards interleaved with the insertion outline. Positions count the cards
  // OTHER than the in-flight one (its node stays mounted, hidden).
  const outline = (
    <div
      key="__drop-outline"
      data-drop-outline
      data-drop-sem={column.sem}
      data-drop-short-term={isShort ? "true" : undefined}
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
    cardNodes.push(
      <CourseCard
        key={card.placement.id}
        card={card}
        status={statusMap[card.placement.id] ?? EMPTY_STATUS}
        pendingChoice={pendingChoices[card.placement.id] ?? null}
        registerRef={registerRef}
        onChainHover={onChainHover}
        onCompleted={onCompleted}
        attribution={attribution[card.placement.id]}
        programInfo={cardPrograms[card.placement.id]}
        beforeCountFor={beforeCountFor}
      />
    );
  }
  if (isDropColumn && dropIndex >= visibleIdx) cardNodes.push(outline);

  const load: "light" | "ok" | "heavy" =
    creditMax < 12 ? "light" : creditMin > 18 ? "heavy" : "ok";

  // Remove an empty short term (D7). Focus lands on the gap "+" that comes
  // back in its place, so keyboard focus never falls to <body>.
  const shortEmpty = column.cards.length === 0;
  const handleRemoveShortTerm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shortEmpty) return;
    if (!removeShortTerm(column.sem)) return;
    const sem = column.sem;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-add-short-term="${sem}"]`)
        ?.focus({ preventScroll: true })
    );
  };

  return (
    <div
      ref={columnRef}
      data-column={isShort ? undefined : column.sem}
      data-short-term-before={isShort ? column.sem : undefined}
      data-column-key={column.key}
      data-suggested-target={isSuggestedTarget ? "true" : undefined}
      onClick={handleColumnClick}
      className={cn(
        "flex w-[216px] shrink-0 flex-col rounded-lg transition-shadow",
        // Suggested target (spec 017 D6): a quieter ring than the live drop
        // target, which wins while a drag hovers this column.
        isSuggestedTarget && !isDropColumn && "ring-1 ring-drop ring-offset-2 ring-offset-canvas",
        isDropColumn && "ring-2 ring-drop ring-offset-2 ring-offset-canvas",
        armedCourse && "cursor-pointer"
      )}
    >
      {isShort ? (
        // Sticky header — the same canvas band and card as a semester's; only
        // the dashed border, the session label and the × set a short term apart
        // (spec 042 D6), so the column reads as one of the board's columns.
        <div className="sticky top-0 z-20 -mx-1 bg-canvas px-1 pb-2 pt-1">
          <div className="flex items-center justify-between gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface/70 px-2.5 py-1.5">
            <div className="flex min-w-0 flex-col">
              <span data-short-term-label className="t-label text-ink-2">
                {term.year !== null ? (
                  <>
                    {term.label.split(" ")[0]} <span className="num">{term.year}</span>
                  </>
                ) : (
                  term.label
                )}
                {creditMax > 0 && (
                  <span className="t-meta normal-case text-ink-4">
                    {" · "}
                    <span className="num">{creditText}</span> cr
                  </span>
                )}
              </span>
              <span className="t-meta">{term.label.split(" ")[0]} session</span>
            </div>
            <Tooltip content={shortEmpty ? `Remove ${term.label}` : "To remove this column, move its classes to another column or remove them from the board"}>
              <button
                type="button"
                data-remove-short-term={column.sem}
                aria-label={`Remove ${term.label}`}
                aria-disabled={shortEmpty ? undefined : "true"}
                onClick={handleRemoveShortTerm}
                className={cn(
                  "flex h-5 w-5 flex-none items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink",
                  shortEmpty
                    ? "text-ink-4 hover:bg-surface-2 hover:text-ink"
                    : "cursor-not-allowed text-line-strong"
                )}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
      /* Sticky header — solid canvas band so cards slide beneath it */
      <div className="sticky top-0 z-20 -mx-1 bg-canvas px-1 pb-2 pt-1">
        <div className="relative flex items-baseline justify-between rounded-lg border border-line bg-surface/70 px-2.5 py-1.5">
          {/* Gap "+" (spec 042 D2): adds the short term before this semester. */}
          {canAddShortTermBefore && (
            <AddShortTermButton sem={column.sem} enteringYear={enteringYear} />
          )}
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
              <Tooltip
                content={
                  overloaded
                    ? `${creditText} credits — over the ${MAX_SEMESTER_CREDITS}-credit cap most students stay under`
                    : `${creditText} credits this semester`
                }
              >
                <span
                  className={cn(
                    "rounded px-1 t-meta",
                    overloaded ? "bg-available-tint font-medium text-available-text" : "text-ink-4"
                  )}
                >
                  <span className="num">{creditText}</span> cr
                </span>
              </Tooltip>
            )}
            <span className="t-meta text-ink-4">
              Sem <span className="num">{label.sem}</span>
            </span>
          </div>
        </div>
        {isSuggestedTarget && (
          <p data-suggested-label className="mt-1 px-1 t-meta text-drop-text">
            Suggested: on the {label.primary} roster
          </p>
        )}
      </div>
      )}

      {/* Cards — pt keeps a hovered first card (translateY(-3px) lift) clear of
          the sticky header's opaque canvas band, which would otherwise paint
          over its top edge (it sits at z-20 above the cards by design). */}
      <div ref={stackRef} data-column-cards className="flex flex-1 flex-col gap-2.5 pb-2 pt-1.5">
        {cardNodes}

        {/* + Add a class — armed course lands here directly (spec 004 §4) */}
        <button
          ref={addButtonRef}
          data-glide="add"
          // The tour points at the first SEMESTER's button, never a short
          // term's (spec 042 D12).
          data-tour={isShort ? undefined : "add-class"}
          onClick={handleAdd}
          className={cn(
            "flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong t-meta text-ink-4",
            // No opacity dimming (B4): at 60% no ink token passes WCAG AA; the
            // quiet look comes from text-ink-4 (AA-raised) + the dashed border.
            "transition-colors hover:border-ink-3 hover:text-ink-2",
            armedCourse && "border-drop text-drop-text"
          )}
          aria-label={
            armedCourse
              ? `Add ${armedCourse.subject} ${armedCourse.number} to ${
                  isShort ? term.label : "this semester"
                }${isSuggestedTarget ? ` (suggested: on the ${label.primary} roster)` : ""}`
              : `Find a class to add to ${isShort ? term.label : "this semester"}`
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
          <p className="t-label text-complete-text">
            {isShort ? "Session complete" : "Semester complete"}
          </p>
        ) : column.cards.length === 0 ? (
          <p className="t-meta text-ink-4">Nothing planned yet.</p>
        ) : isShort ? (
          // No load bands on a short term (spec 042 D5): just the total.
          <p className="t-meta">
            <span className="num">{creditText}</span> credits planned
          </p>
        ) : (
          <Tooltip
            content={
              load === "light"
                ? "A light load — most students carry 12–18 credits."
                : load === "heavy"
                  ? "That's a heavy load — most students stay under 18 credits."
                  : "A healthy load."
            }
          >
            <p className="t-meta">
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
          </Tooltip>
        )}
      </div>
    </div>
  );
}
