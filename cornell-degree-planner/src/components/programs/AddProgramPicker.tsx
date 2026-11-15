import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrograms } from "@/hooks/usePrograms";
import { useMinorIndex } from "@/hooks/useAdditionalProgramData";
import { collegeShortName, programCollegeId } from "@/lib/planner/colleges";
import {
  majorGroups,
  minorGroups,
  type AddAvailability,
  type PickerContext,
  type PickerGroup,
  type PickerRow,
} from "./programsModel";

export type AddProgramPickerProps = {
  id: string;
  initialTab: "major" | "minor";
  ctx: PickerContext;
  add: { major: AddAvailability; minor: AddAvailability };
  onPick: (row: PickerRow) => void;
};

/**
 * The add picker (spec 047 D5, the canvas's option 2 popover): a Second major
 * / Minor toggle, a search, and results grouped by college. Second majors are
 * the primary's own college's visible majors (D1); minors come from the minor
 * index, grouped by who offers them. A program that can't join is listed
 * disabled with its reason: already on the plan, not open to a major on the
 * plan (D12; a major that a minor already on the plan isn't open to, the
 * other way round), or a combination its layer forbids (D14, when that layer is
 * already loaded; otherwise the panel's overlap line says so once it's added).
 * Arrow keys move between the search and the rows; Enter adds.
 */
export const AddProgramPicker = forwardRef<HTMLDivElement, AddProgramPickerProps>(function AddProgramPicker(
  { id, initialTab, ctx, add, onPick },
  ref
) {
  const [tab, setTab] = useState<"major" | "minor">(initialTab);
  const [query, setQuery] = useState("");
  const { programs } = usePrograms();
  const minors = useMinorIndex();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, [tab]);

  const availability = add[tab];
  const groups: PickerGroup[] =
    tab === "major" ? majorGroups(programs, ctx, query) : minorGroups(minors.entries, ctx, query);
  // At the cap (or a primary that allows no second major) every row is off,
  // with the panel button's reason.
  const blocked = availability.enabled ? null : availability.label;

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-picker-row]:not(:disabled)") ?? [])];
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = rows();
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") all[Math.min(at + 1, all.length - 1)]?.focus();
    else if (at <= 0) searchRef.current?.focus();
    else all[at - 1]?.focus();
  };

  const college = programCollegeId(ctx.primaryProgram);
  const footer =
    tab === "major"
      ? `Second majors list ${college === "cas" || college === "cals" ? collegeShortName(college) : "Arts & Sciences and CALS"} majors only. Adding one puts its still-needed required classes in Tried.`
      : "Adding a minor puts its still-needed required classes in Tried.";

  const empty =
    tab === "minor" && minors.status === "loading"
      ? "Loading minors…"
      : tab === "minor" && minors.status === "error"
        ? "Couldn't load the minors right now."
        : query.trim()
          ? "No matches."
          : tab === "minor"
            ? "No minors yet."
            : "No second majors to add.";

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Add a program"
      data-add-picker
      onKeyDown={onListKey}
      className="absolute right-0 top-full z-[var(--z-sidebar-panel)] mt-1.5 flex w-[360px] flex-col gap-2 rounded-[10px] border border-line bg-surface p-2.5 shadow-xl"
    >
      <div role="group" aria-label="Program kind" className="grid grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-[3px]">
        {(["major", "minor"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              setQuery("");
            }}
            className={cn(
              "h-7 rounded-md t-meta font-semibold transition-colors",
              tab === t ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
            )}
          >
            {t === "major" ? "Second major" : "Minor"}
          </button>
        ))}
      </div>

      <label className="flex h-[34px] items-center gap-2 rounded-lg border border-line px-2.5 text-ink-3 focus-within:border-ink">
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{tab === "major" ? "Search majors" : "Search minors"}</span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "major" ? "Search majors" : "Search minors"}
          className="min-w-0 flex-1 border-0 bg-transparent t-body text-ink outline-none"
        />
      </label>

      {blocked && <p className="px-2 t-meta text-ink-3">{blocked}</p>}

      <div ref={listRef} className="flex max-h-72 flex-col gap-px overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-2 py-2 t-meta text-ink-3">{empty}</p>
        ) : (
          groups.map((g, gi) => (
            <div key={g.label} role="group" aria-label={g.label} className="flex flex-col gap-px">
              <p className={cn("px-2 pb-0.5 t-label text-ink-3", gi === 0 ? "pt-1" : "pt-2")}>{g.label}</p>
              {g.rows.map((r) => {
                const reason = r.disabledReason ?? blocked;
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-picker-row={r.id}
                    disabled={reason != null}
                    onClick={() => onPick(r)}
                    className="group flex items-center justify-between gap-3 rounded-md px-2 py-[7px] text-left t-body text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:cursor-default disabled:text-ink-4 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 truncate">{r.name}</span>
                    {reason != null && r.disabledReason != null ? (
                      <span className="shrink-0 t-meta">{r.disabledReason}</span>
                    ) : reason == null ? (
                      <span className="hidden shrink-0 t-meta text-ink-3 group-focus-visible:inline">Enter to add</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <p className="border-t border-line-faint px-2 pb-0.5 pt-2 t-meta leading-snug text-ink-3">{footer}</p>
    </div>
  );
});
