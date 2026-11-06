import { useMemo } from "react";
import type { Course } from "@/types/db";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { TriedProgress } from "@/hooks/useRequirementProgress";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { usePlannerStore } from "@/store/usePlannerStore";
import { recordToCourse } from "@/lib/catalog/recordToCourse";
import { targetHighlightSem } from "@/lib/planner/armHighlight";
import { cn } from "@/lib/utils";
import { REMINDER_LIST_CAP } from "./railLines";

/**
 * TriedReminder (spec 028 D13) — under Still needed, the classes the student
 * is trying (Requirements page) that aren't on the board yet: one line each
 * with what it would fill and a Place button, plus Clear. At most two lines
 * tall; more scroll inside it. Absent when nothing tried is off the board.
 *
 * Place is the board's click-to-place, exactly as "Place on board" from
 * Classes (spec 017 D6): the course is armed and, when it is on the
 * enrollment term's roster, that term's column is suggested. A class the
 * catalog no longer has reads "no longer offered" with Remove.
 *
 * DOM contract: [data-tried-reminder] on the box, [data-tried-item=<course id>]
 * per line (+ [data-tried-missing] when no longer offered).
 */

type Entry = {
  id: string;
  code: string;
  fill: string | null;
  missing: boolean;
  course: Course | null;
  roster: string | null;
};

export function TriedReminder({ tried, columnSems }: { tried: TriedProgress | undefined; columnSems: number[] }) {
  const { untryCourse, clearTried } = usePlan();
  const { enteringYear } = useAuth();
  const { index, courseDetails, aliases, enrollmentTarget } = useCatalogContext();
  const armCourse = usePlannerStore((s) => s.armCourse);

  const notOnBoard = tried?.notOnBoard;
  const entries = useMemo<Entry[]>(() => {
    if (!tried || !notOnBoard || notOnBoard.length === 0) return [];
    const canon = (id: string) => aliases[id] ?? id;
    // One pass over the index for just these ids (at most 20).
    const wanted = new Set(notOnBoard.flatMap((id) => [id, canon(id)]));
    const records = new Map<string, CatalogIndexRecord>();
    for (const r of index) if (wanted.has(r.id)) records.set(r.id, r);
    const missing = new Set(tried.missing);
    return notOnBoard.map((id) => {
      const full = courseDetails[canon(id)] ?? courseDetails[id] ?? null;
      const record = records.get(canon(id)) ?? records.get(id) ?? null;
      const course = missing.has(id) ? null : (full ?? (record ? recordToCourse(record) : null));
      return {
        id,
        code: course ? `${course.subject} ${course.number}` : id.replace(/-/g, " "),
        fill: tried.fills[id]?.[0] ?? null,
        missing: missing.has(id),
        course,
        roster: full?.roster ?? record?.roster ?? null,
      };
    });
  }, [tried, notOnBoard, index, courseDetails, aliases]);

  if (entries.length === 0) return null;

  const place = (e: Entry) => {
    if (!e.course) return;
    const highlightSem = targetHighlightSem({ roster: e.roster }, enrollmentTarget, enteringYear, columnSems);
    armCourse(e.course, null, { highlightSem });
  };

  return (
    <section
      data-tried-reminder
      aria-label="Classes you're trying that aren't on your board"
      className="flex flex-col gap-1 rounded-lg border border-dashed border-drop bg-drop-tint px-2 py-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold text-drop-text">
          Trying · not on your board (<span className="num">{entries.length}</span>)
        </p>
        <button
          type="button"
          data-tried-clear
          onClick={clearTried}
          className="t-meta text-ink-3 underline underline-offset-2 hover:text-ink"
        >
          Clear
        </button>
      </div>
      <ul data-tried-list className={cn("flex flex-col gap-1 pr-0.5", REMINDER_LIST_CAP)}>
        {entries.map((e) => (
          <li
            key={e.id}
            data-tried-item={e.id}
            data-tried-missing={e.missing || undefined}
            className="grid min-h-[21px] grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 text-[10.5px]"
          >
            <span className="truncate" title={e.fill ? `${e.code} · ${e.fill}` : e.code}>
              <b className="font-bold">{e.code}</b>
              {e.missing ? (
                <span className="text-ink-3"> · no longer offered</span>
              ) : (
                e.fill && <span className="text-ink-2"> · {e.fill}</span>
              )}
            </span>
            {e.missing ? (
              <button
                type="button"
                onClick={() => untryCourse(e.id)}
                aria-label={`Stop trying ${e.code}`}
                className="rounded px-1.5 py-px text-[10px] font-semibold text-ink-3 underline underline-offset-2 hover:text-ink"
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                onClick={() => place(e)}
                disabled={!e.course}
                aria-label={`Place ${e.code} on your board`}
                className="rounded-[5px] bg-drop-text px-1.5 py-px text-[10px] font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Place
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
