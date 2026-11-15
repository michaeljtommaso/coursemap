import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EXAM_TABLES } from "@/data/credit-tables";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { collegeLimitsFor } from "@/lib/credit/resolve";
import { MAX_CREDIT_ENTRIES, type ExamFamily, type ExamTables } from "@/lib/credit/types";
import type { CreditEntry } from "@/lib/schemas";
import { collegeShortName } from "@/lib/planner/colleges";
import type { MajorRef } from "@/lib/credit/limitScope";
import { ExamPicker } from "./ExamPicker";
import type { ExamFills } from "./ExamRow";
import { TransferSection } from "./TransferSection";
import { FAMILY_NAV_LABEL, FAMILY_ORDER, examsByFamily, formatCredits } from "./examDisplay";
import {
  addTransfer,
  atCap,
  draftCredits,
  removeTransfer,
  toggleScore,
  type CreditDraft,
} from "./creditDraft";

/** A side list entry: an exam family, "exams" (the one exam entry while the
 *  tables are missing), or the transfer courses. */
type Section = ExamFamily | "exams" | "transfer";

/**
 * CreditsEditor (spec 028 D4–D6, D2; spec 045 D4/D5) — the one credits
 * editor, shared by the "My credits" dialog and first run's credit step.
 * Controlled: the host owns the draft (draftFromProfile on open) and saves
 * draftToEntries(draft) through setCreditProfile with its own saving / error
 * idiom. The host bounds the height (className); the right pane scrolls.
 *
 * Two panes. Left, a side list: Exams (AP · IB · A-Level · Other exams, each
 * with its pick count), Other colleges (Transfer courses), then the running
 * total and the college's own limits. Right, the chosen section: an exam
 * family's rows (one click picks a score; the search looks across every
 * family) or the transfer courses with the add form.
 * Entries the editor doesn't understand ride along untouched (draft.kept).
 */
export function CreditsEditor({
  draft,
  onChange,
  tables = EXAM_TABLES,
  major: majorOverride,
  examFills,
  className,
}: {
  draft: CreditDraft;
  onChange: (next: CreditDraft) => void;
  /** Injected by tests; the app uses the bundled tables. */
  tables?: ExamTables | null;
  /** The major to word credit lines for, when it isn't chosen yet (first
   *  run's pending program). Defaults to the chosen program. */
  major?: MajorRef | null;
  /** What each saved exam score fills on the board (see ExamRow). */
  examFills?: ExamFills;
  /** The host sets the height here. */
  className?: string;
}) {
  const { college, major: chosenMajor } = useCreditProfile();
  const major = majorOverride !== undefined ? majorOverride : chosenMajor;
  const capped = atCap(draft);

  const byFamily = useMemo(() => (tables ? examsByFamily(tables) : null), [tables]);
  const familyOf = useMemo(
    () => new Map((tables?.exams ?? []).map((e) => [e.id, e.family] as const)),
    [tables]
  );
  const families = byFamily ? FAMILY_ORDER.filter((f) => byFamily[f].length > 0) : [];
  const examSections: Section[] = families.length > 0 ? families : ["exams"];
  const sections: Section[] = [...examSections, "transfer"];

  const [section, setSection] = useState<Section>(examSections[0]);
  const active = sections.includes(section) ? section : sections[0];
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});

  const limits = collegeLimitsFor(college, tables);
  const total = draftCredits(draft, college, tables);

  const onToggle = (exam: string, score: string) => onChange(toggleScore(draft, exam, score));
  const examCount = Object.keys(draft.picks).length;
  const takenIds = [...draft.transfers, ...draft.kept].map((e) => e.id);

  const countFor = (s: Section): number => {
    if (s === "transfer") return draft.transfers.length;
    if (s === "exams") return examCount;
    return Object.keys(draft.picks).filter((id) => familyOf.get(id) === s).length;
  };

  // One Tab stop for the side list; arrows move through both groups.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, s: Section) => {
    const i = sections.indexOf(s);
    const n = sections.length;
    const next =
      e.key === "ArrowDown"
        ? sections[(i + 1) % n]
        : e.key === "ArrowUp"
          ? sections[(i - 1 + n) % n]
          : e.key === "Home"
            ? sections[0]
            : e.key === "End"
              ? sections[n - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    setSection(next);
    tabRefs.current[next]?.focus();
  };

  const tab = (s: Section) => {
    const selected = s === active;
    const n = countFor(s);
    const label = s === "transfer" ? "Transfer courses" : s === "exams" ? "All exams" : FAMILY_NAV_LABEL[s];
    return (
      <button
        key={s}
        ref={(el) => {
          tabRefs.current[s] = el;
        }}
        type="button"
        role="tab"
        id={`credits-tab-${s}`}
        aria-selected={selected}
        aria-controls="credits-tabpanel"
        tabIndex={selected ? 0 : -1}
        onClick={() => setSection(s)}
        onKeyDown={(e) => onTabKey(e, s)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left t-body transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
          selected
            ? "border-line bg-surface font-semibold text-ink"
            : "border-transparent text-ink-2 hover:bg-surface/70 hover:text-ink"
        )}
      >
        <span>{label}</span>
        {n > 0 && (
          <>
            <span aria-hidden="true" className="num t-meta font-bold text-drop-text">
              {n}
            </span>
            <span className="sr-only">, {n} {s === "transfer" ? "added" : "picked"}</span>
          </>
        )}
      </button>
    );
  };

  const intro = (
    <p className="t-body text-ink-2">
      Click the score you got on each exam you took
      {college ? (
        <>
          {" "}— we&apos;ll show what it earns in{" "}
          <span className="font-semibold text-ink">{collegeShortName(college)}</span>.
        </>
      ) : (
        " — we'll show what it earns at Cornell."
      )}
    </p>
  );

  return (
    <div className={cn("flex min-h-0 overflow-hidden", className)} data-credits-editor>
      <div className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-2/60 px-3 py-4">
        <p id="credits-nav-exams" className="px-2.5 pb-1.5 t-label">
          Exams
        </p>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-labelledby="credits-nav-exams"
          className="flex flex-col gap-0.5"
        >
          {examSections.map(tab)}
        </div>
        <p id="credits-nav-colleges" className="px-2.5 pb-1.5 pt-5 t-label">
          Other colleges
        </p>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-labelledby="credits-nav-colleges"
          className="flex flex-col gap-0.5"
        >
          {tab("transfer")}
        </div>

        <div className="mt-auto pt-5">
          <div className="flex flex-col gap-1 border-t border-line px-2.5 pt-3" data-credits-total>
            <p className="text-ink">
              <span className="num t-headline">{formatCredits(total)} cr</span>{" "}
              <span className="t-meta text-ink-3">before Cornell</span>
            </p>
            {limits.map((l) => (
              <p key={l} className="t-meta text-ink-3" data-credits-limit>
                {l}
              </p>
            ))}
            <p className="num mt-1 t-meta text-ink-3" aria-live="polite">
              {summary(examCount, draft.transfers.length)}
              {capped && (
                <span className="block font-semibold text-available-text">
                  You&apos;ve reached {MAX_CREDIT_ENTRIES} credits — remove one to add another.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div
        role="tabpanel"
        id="credits-tabpanel"
        aria-labelledby={`credits-tab-${active}`}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        {/* Always mounted, hidden while another section shows, so a
            half-filled "Add a transfer course" form survives a look at the
            exams. */}
        <div hidden={active !== "transfer"} data-credits-transfer-section>
          <TransferSection
            transfers={draft.transfers}
            onAdd={(entry) => onChange(addTransfer(draft, entry))}
            onRemove={(id) => onChange(removeTransfer(draft, id))}
            blocked={capped}
            takenIds={takenIds}
          />
        </div>
        {active === "transfer" ? null : tables && active !== "exams" ? (
          <ExamPicker
            key={active}
            tables={tables}
            family={active}
            intro={intro}
            picks={draft.picks}
            onToggle={onToggle}
            college={college}
            major={major}
            examFills={examFills}
            newPicksBlocked={capped}
            collegeLimits={limits}
          />
        ) : (
          <div className="px-6 py-4">
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/50 px-4 py-3"
            >
              <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <p className="t-body font-semibold text-ink-2">Exam list unavailable</p>
                <p className="t-meta text-ink-3">
                  Cornell&apos;s exam credit tables aren&apos;t loaded right now. Exams you saved before
                  are kept as they are, and you can still add transfer courses under Transfer courses.
                </p>
              </div>
            </div>
          </div>
        )}

        {draft.kept.length > 0 && <KeptNote entries={draft.kept} />}
      </div>
    </div>
  );
}

function summary(exams: number, transfers: number): string {
  if (exams === 0 && transfers === 0) return "Nothing added yet.";
  const parts: string[] = [];
  if (exams > 0) parts.push(`${exams} exam${exams === 1 ? "" : "s"}`);
  if (transfers > 0) parts.push(`${transfers} transfer course${transfers === 1 ? "" : "s"}`);
  return `Added: ${parts.join(" · ")}`;
}

/** Saved entries the editor can't show as rows: listed, kept as they are. */
function KeptNote({ entries }: { entries: CreditEntry[] }) {
  return (
    <div className="flex flex-col gap-1 px-6 pb-4" data-credits-kept>
      <p className="t-label">Also saved</p>
      <p className="t-meta text-ink-3">
        {entries.map((e) => e.label).join(" · ")} — kept as saved.
      </p>
    </div>
  );
}
