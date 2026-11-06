import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditCollege, ExamDef, ExamFamily, ExamTables } from "@/lib/credit/types";
import { ExamRow } from "./ExamRow";
import { FAMILY_LABEL, FAMILY_ORDER, groupIntl, matchesQuery, sortExams } from "./examDisplay";

/**
 * The exam half of the credits editor (spec 025 D4): AP · IB · A-Level ·
 * Other tabs, a search box that looks across every tab, and one ExamRow per
 * exam. Tabs show how many exams are picked in them, so picks in another tab
 * are never out of sight.
 */
export function ExamPicker({
  tables,
  picks,
  onToggle,
  college,
  newPicksBlocked,
  listClassName,
}: {
  tables: ExamTables;
  picks: Record<string, string>;
  onToggle: (exam: string, score: string) => void;
  college: CreditCollege;
  newPicksBlocked: boolean;
  /** The host bounds the list's height (it scrolls inside). */
  listClassName?: string;
}) {
  const [tab, setTab] = useState<ExamFamily>("ap");
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const byFamily = useMemo(() => {
    const m = {} as Record<ExamFamily, ExamDef[]>;
    for (const f of FAMILY_ORDER) m[f] = [];
    for (const e of tables.exams) m[e.family]?.push(e);
    return m;
  }, [tables]);
  const families = FAMILY_ORDER.filter((f) => byFamily[f].length > 0);
  const activeTab = families.includes(tab) ? tab : families[0];

  const pickedIn = (f: ExamFamily) => byFamily[f].filter((e) => picks[e.id] !== undefined).length;

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
      newPicksBlocked={newPicksBlocked}
      showFamily={showFamily}
    />
  );

  const familyList = (f: ExamFamily) => {
    if (f === "intl") {
      return groupIntl(byFamily.intl).map((g) => (
        <section key={g.group} aria-label={g.group} className="flex flex-col gap-0.5">
          <p className="px-3 pb-0.5 pt-2 t-label">{g.group}</p>
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
        <p className="px-3 pb-0.5 pt-3 t-label">All {FAMILY_LABEL[f]} exams</p>
        <ul className="flex flex-col gap-0.5">{rest.map((e) => row(e, false))}</ul>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exams — Calculus, Biology HL, Physics…"
          aria-label="Search exams"
          className="w-full rounded-md border border-line bg-surface py-2 pl-8 pr-8 t-body outline-none placeholder:text-ink-4 focus:border-ink focus:ring-1 focus:ring-ink"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-4 hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {!searching && (
        <div
          role="tablist"
          aria-label="Exam type"
          className="flex rounded-lg border border-line bg-surface-2/70 p-0.5"
        >
          {families.map((f) => {
            const n = pickedIn(f);
            const selected = f === activeTab;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                id={`credits-tab-${f}`}
                aria-selected={selected}
                aria-controls="credits-tabpanel"
                onClick={() => setTab(f)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 t-label transition-colors",
                  selected ? "border-line bg-surface text-ink" : "border-transparent text-ink-3 hover:text-ink"
                )}
              >
                {FAMILY_LABEL[f]}
                {n > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="num rounded-full bg-drop px-1.5 text-[0.5625rem] font-bold leading-4 text-canvas"
                    >
                      {n}
                    </span>
                    <span className="sr-only">, {n} picked</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {searching ? (
        <div aria-live="polite" className={cn("overflow-y-auto", listClassName)}>
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center t-body text-ink-3">
              No exam matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">{results.map((e) => row(e, true))}</ul>
          )}
        </div>
      ) : (
        activeTab && (
          <div
            key={activeTab}
            role="tabpanel"
            id="credits-tabpanel"
            aria-labelledby={`credits-tab-${activeTab}`}
            className={cn("overflow-y-auto", listClassName)}
          >
            {familyList(activeTab)}
          </div>
        )
      )}
    </div>
  );
}
