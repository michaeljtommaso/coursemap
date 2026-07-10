import { cn } from "@/lib/utils";
import { formatCredits } from "@/lib/planner/semesters";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * DirectoryRow (spec 006 §E2) — one course row in the /classes directory: code,
 * title, credits, a has-prerequisites dot, and term chips (from the index's
 * `offered`, once the roster-sync rebuild populates it — §E3). The whole row
 * opens the CourseDetailPanel. The favorite ★ (§E4) is injected as `leading`.
 */

const TERM_NAMES: Record<string, string> = { FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" };

function offeredOf(r: CatalogIndexRecord): string[] {
  const v = (r as Record<string, unknown>).offered;
  return Array.isArray(v) ? (v as string[]) : [];
}

export function DirectoryRow({
  record,
  onOpen,
  leading,
}: {
  record: CatalogIndexRecord;
  onOpen: () => void;
  /** Optional slot before the code (the favorite ★ from §E4). */
  leading?: React.ReactNode;
}) {
  const credits = formatCredits({ min: record.creditsMin, max: record.creditsMax });
  const offered = offeredOf(record);

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
        <span className="min-w-0 flex-1 truncate t-body text-ink-2 group-hover:text-ink">
          {record.title}
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
