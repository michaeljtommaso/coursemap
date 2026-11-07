import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { meetingSummary, parseMeets, type ScheduleQuery } from "@/lib/classes/schedule";
import { formatCredits } from "@/lib/planner/semesters";
import { leadLine } from "@/lib/classes/targetFilter";
import { EMPTY_RATINGS, type ProfessorRatingsMap } from "@/lib/classes/professorRatings";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * DirectoryRow (spec 006 §E2) — one course row in the /classes directory: code,
 * title, credits, a has-prerequisites dot, and term chips (from the index's
 * `offered`, once the roster-sync rebuild populates it — §E3). The whole row
 * opens the CourseDetailPanel. The favorite ★ (§E4) is injected as `leading`.
 *
 * Spec 017 D4 adds the lead-lecturer line — "Ada Lovelace  3.6 ★  +1" — with "≈"
 * before a probable match's rating, the name alone when there's no live rating,
 * and a same-size term label ("Fall 2026: …") when the course's sections aren't
 * from the enrollment term. On desktop it shares the title's line and truncates
 * before the title does, with the rating and "+N" in fixed-width slots so they
 * line up from row to row; under 640px it moves under the title. "+N" caps at
 * "+9+" (the exact count is in the hover text).
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

export function DirectoryRow({
  record,
  onOpen,
  leading,
  enrollmentTarget = null,
  ratings = EMPTY_RATINGS,
  scheduleQuery = null,
}: {
  /** Spec 021 — the active schedule filter, so the time chip leads with the
   *  lecture option that matched. null when no schedule filter is on. */
  scheduleQuery?: ScheduleQuery | null;
  record: CatalogIndexRecord;
  onOpen: () => void;
  /** Optional slot before the code (the favorite ★ from §E4). */
  leading?: React.ReactNode;
  /** Enrollment-term roster slug ("SP27"); decides the term label. */
  enrollmentTarget?: string | null;
  /** Live ratings by netid; empty when ratings are off or unavailable. */
  ratings?: ProfessorRatingsMap;
}) {
  const credits = formatCredits({ min: record.creditsMin, max: record.creditsMax });
  const offered = record.offered;
  const prof = leadLine(record, enrollmentTarget, ratings);
  // Spec 021 — the lecture time, only when it's the enrollment term's (another
  // term's times aren't next term's).
  const time = useMemo(
    () =>
      !enrollmentTarget || record.roster === enrollmentTarget
        ? meetingSummary(parseMeets(record.meets), scheduleQuery)
        : null,
    [record, enrollmentTarget, scheduleQuery]
  );
  // With ratings loaded, every row keeps a rating slot (empty when its lead
  // has none) so the column lines up; with ratings off there is no slot.
  const showRatingSlot = ratings.size > 0;

  return (
    <li data-tour="class-row" className="flex items-center gap-2">
      {leading}
      <button
        onClick={onOpen}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2"
        aria-label={`${record.subject} ${record.number} ${record.title} — details`}
      >
        <span className="flex w-24 shrink-0 items-center gap-1.5">
          <span className="t-label normal-case tracking-normal text-ink group-hover:text-ink">
            {record.subject} {record.number}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 truncate t-body text-ink-2 group-hover:text-ink sm:flex-[1_1_auto]">
            {record.title}
          </span>
          {prof && (
            <span
              className="flex min-w-0 items-baseline gap-1.5 t-body text-ink-3 sm:max-w-[45%] sm:flex-[0_100_auto] sm:gap-1"
              data-testid="lead-line"
            >
              <span className="min-w-0 truncate sm:text-right" data-testid="lead-name">
                {prof.termLabel && (
                  <span className="font-semibold text-ink-2">{prof.termLabel}: </span>
                )}
                <span className="text-ink-2">{prof.name}</span>
              </span>
              {/* Fixed-width, right-aligned slots on desktop so ratings (and
                  the +N after them) form a column from row to row. Empty slots
                  keep the column but collapse under 640px, where the line sits
                  under the title. The rating slot only exists with ratings on. */}
              {showRatingSlot && (
                <span
                  data-testid="lead-rating"
                  className={cn(
                    "num shrink-0 whitespace-nowrap sm:w-12 sm:text-right",
                    !prof.rating && "hidden sm:inline-block",
                    prof.probable ? "italic text-ink-4" : "text-ink-2"
                  )}
                  title={prof.rating && prof.probable ? "Probable match — not verified" : undefined}
                >
                  {/* The middle dot reads "Name · 3.6 ★" on the stacked
                      mobile line; on desktop the column itself separates. */}
                  {prof.rating && (
                    <span className="not-italic text-ink-3 sm:hidden">{" · "}</span>
                  )}
                  {prof.rating && (prof.probable ? "≈" : "")}
                  {prof.rating}
                </span>
              )}
              <span
                data-testid="lead-more"
                className={cn(
                  "num shrink-0 whitespace-nowrap text-ink-4 sm:w-7 sm:text-left",
                  !prof.moreLabel && "hidden sm:inline-block"
                )}
                title={prof.moreTitle || undefined}
              >
                {prof.moreLabel && ` ${prof.moreLabel}`}
              </span>
            </span>
          )}
        </span>
        {/* A steady width on desktop (fits three term chips, the prereqs dot
            and credits) so the professor column above ends at the same place
            on every row; a row with more chips simply grows. */}
        <span className="flex shrink-0 items-center gap-2 sm:min-w-[12rem] sm:justify-end">
          {time && (
            <span
              className="num whitespace-nowrap t-meta text-ink-2"
              data-testid="meeting-time"
              title={
                time.more > 0
                  ? `Class time — ${time.more} other ${time.more === 1 ? "time" : "times"} to choose from`
                  : "Class time"
              }
            >
              {time.label}
              {time.more > 0 && <span className="text-ink-4"> +{time.more}</span>}
            </span>
          )}
          {offered.map((t) => (
            <span
              key={t}
              className="rounded border border-line px-1 t-meta text-ink-3"
              title={TERM_NAMES[t] ?? t}
            >
              {t}
            </span>
          ))}
          {record.hasPrereqs && (
            <span
              className="inline-flex items-center gap-1 t-meta text-ink-4"
              title="Has prerequisites"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full bg-available")} />
              prereqs
            </span>
          )}
          {credits && (
            <span className="w-12 text-right t-meta text-ink-3">
              <span className="num">{credits}</span> cr
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
