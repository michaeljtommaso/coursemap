import { cn } from "@/lib/utils";
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
 * Spec 017 D4 adds the lead-lecturer line — "Ada Lovelace · 3.6 ★ +1" — with "≈"
 * before a probable match's rating, the name alone when there's no live rating,
 * and a same-size term label ("Fall 2026: …") when the course's sections aren't
 * from the enrollment term. On desktop it shares the title's line and truncates
 * before the title does; under 640px it moves under the title.
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

export function DirectoryRow({
  record,
  onOpen,
  leading,
  enrollmentTarget = null,
  ratings = EMPTY_RATINGS,
}: {
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

  return (
    <li className="flex items-center gap-2">
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
              className="min-w-0 truncate t-body text-ink-3 sm:max-w-[45%] sm:flex-[0_100_auto]"
              data-testid="lead-line"
            >
              {prof.termLabel && (
                <span className="font-semibold text-ink-2">{prof.termLabel}: </span>
              )}
              <span className="text-ink-2">{prof.name}</span>
              {prof.rating && (
                <>
                  {" · "}
                  <span
                    className={cn("num", prof.probable ? "italic text-ink-4" : "text-ink-2")}
                    title={prof.probable ? "Probable match — not verified" : undefined}
                  >
                    {prof.probable ? "≈" : ""}
                    {prof.rating}
                  </span>
                </>
              )}
              {prof.more > 0 && (
                <span
                  className="num text-ink-4"
                  title={`${prof.more} more ${prof.more === 1 ? "instructor" : "instructors"}`}
                >
                  {" "}+{prof.more}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
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
