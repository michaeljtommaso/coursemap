import { useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { CreditCollege, ExamDef, ExamFamily, ExamTables } from "@/lib/credit/types";
import type { MajorRef } from "@/lib/credit/limitScope";
import type { ExamFills } from "./ExamRow";
import { ExamRow } from "./ExamRow";
import { FAMILY_LABEL, FAMILY_ORDER, examsByFamily, groupIntl, matchesQuery, sortExams } from "./examDisplay";

/**
 * The exam side of the credits editor (spec 028 D4, spec 045 D4): an intro
 * line and a search box that stay at the top of the pane, then one exam
 * family's rows. The family is picked in the editor's side list; a query
 * searches every family and lists the matches across them.
 */
export function ExamPicker({
  tables,
  family,
  intro,
  picks,
  onToggle,
  college,
  major = null,
  examFills,
  newPicksBlocked,
  collegeLimits,
}: {
  tables: ExamTables;
  /** The family the side list has selected. */
  family: ExamFamily;
  /** The line above the search box. */
  intro?: ReactNode;
  picks: Record<string, string>;
  onToggle: (exam: string, score: string) => void;
  college: CreditCollege;
  /** The chosen major: lines written for other majors are left out. */
  major?: MajorRef | null;
  examFills?: ExamFills;
  newPicksBlocked: boolean;
  /** The college's own limits, shown once in the side list, not per row. */
  collegeLimits?: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const byFamily = useMemo(() => examsByFamily(tables), [tables]);

  const results = useMemo(
    () =>
      searching
        ? FAMILY_ORDER.flatMap((f) => sortExams(byFamily[f].filter((e) => matchesQuery(e, query))))
        : [],
    [searching, byFamily, query]
  );

  const row = (def: ExamDef, showFamily: boolean) => (
    <ExamRow
      key={def.id}
      def={def}
      picked={picks[def.id]}
      onToggle={onToggle}
      tables={tables}
      college={college}
      major={major}
      fills={examFills?.[def.id]}
      newPicksBlocked={newPicksBlocked}
      showFamily={showFamily}
      collegeLimits={collegeLimits}
    />
  );

  const familyList = (f: ExamFamily) => {
    if (f === "intl") {
      return groupIntl(byFamily.intl).map((g) => (
        <section key={g.group} aria-label={g.group} className="flex flex-col gap-0.5">
          <p className="px-3 pb-0.5 pt-3 t-label">{g.group}</p>
          <ul className="flex flex-col gap-0.5">{g.exams.map((e) => row(e, false))}</ul>
        </section>
      ));
    }
    const sorted = sortExams(byFamily[f]);
    const common = sorted.filter((e) => e.common);
    const rest = sorted.filter((e) => !e.common);
    if (common.length === 0 || rest.length === 0) {
      return <ul className="flex flex-col gap-0.5">{sorted.map((e) => row(e, false))}</ul>;
    }
    return (
      <>
        <p className="px-3 pb-0.5 t-label">Most taken</p>
        <ul className="flex flex-col gap-0.5">{common.map((e) => row(e, false))}</ul>
        <p className="px-3 pb-0.5 pt-4 t-label">All {FAMILY_LABEL[f]} exams</p>
        <ul className="flex flex-col gap-0.5">{rest.map((e) => row(e, false))}</ul>
      </>
    );
  };

  return (
    <div className="flex flex-col">
      {/* Stays put while the pane scrolls under it. */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-surface px-6 pb-3 pt-4">
        {intro}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every exam: Calculus, Biology HL, Physics…"
            aria-label="Search exams"
            className="w-full rounded-lg border border-line-strong bg-surface py-2.5 pl-9 pr-9 t-body outline-none placeholder:text-ink-4 focus:border-ink focus:ring-1 focus:ring-ink"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-4 hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-4" aria-live={searching ? "polite" : undefined} data-exam-list>
        {searching ? (
          results.length === 0 ? (
            <p className="px-3 py-6 text-center t-body text-ink-3">
              No exam matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">{results.map((e) => row(e, true))}</ul>
          )
        ) : (
          familyList(family)
        )}
      </div>
    </div>
  );
}
