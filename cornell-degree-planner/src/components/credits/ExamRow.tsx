import { Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { examResult, scoresThatEarn } from "@/lib/credit/resolve";
import { MAX_CREDIT_ENTRIES, type CreditCollege, type ExamDef, type ExamTables } from "@/lib/credit/types";
import { FAMILY_LABEL, awardSummary, examDisplayName, noCreditText } from "./examDisplay";
import { Tooltip } from "@/components/ui/Tooltip";
import { visibleCreditText, type MajorRef } from "@/lib/credit/limitScope";

/** Per exam id: the saved score and the requirements it fills on the board
 *  (useRequirementProgress().creditFills, keyed here by exam). */
export type ExamFills = Record<string, { score: string; requirements: string[] }>;

/**
 * One exam (spec 028 D6): its name, then a toggle button per score that earns
 * something in some college. Click a score to pick it, click it again to
 * clear, click another to switch. A picked row says what it earns for this
 * student's college, with any limits underneath.
 */
export function ExamRow({
  def,
  picked,
  onToggle,
  tables,
  college,
  major = null,
  fills,
  newPicksBlocked,
  showFamily,
}: {
  def: ExamDef;
  picked: string | undefined;
  onToggle: (exam: string, score: string) => void;
  tables: ExamTables;
  college: CreditCollege;
  /** The chosen major: lines written for other majors are left out. */
  major?: MajorRef | null;
  /** What this exam's saved score fills on the board, if known. */
  fills?: ExamFills[string];
  /** At the 60-entry cap: an unpicked row can't be picked (switching can). */
  newPicksBlocked: boolean;
  /** Search results mix families: prefix the name with AP / IB / … */
  showFamily: boolean;
}) {
  const earning = scoresThatEarn(def.id, tables);
  // A saved score that no longer earns anywhere still shows, so it can be
  // cleared; the order stays the exam's scale (lowest first).
  const scores = def.scale.filter((s) => earning.includes(s) || s === picked);
  const fullName = examDisplayName(def);
  const result = picked ? examResult(def.id, picked, college, tables) : null;
  // Fills describe the saved score; a different pick in the editor isn't placed yet.
  const filled = fills && fills.score === picked ? fills.requirements : undefined;
  const shown = result ? visibleCreditText(result, major, filled) : null;
  const blocked = newPicksBlocked && picked === undefined;

  return (
    <li
      data-exam={def.id}
      className={cn(
        "rounded-lg border px-3 py-2 transition-colors",
        picked ? "border-drop/60 bg-drop-tint/50" : "border-transparent hover:bg-surface-2/70"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 t-body font-semibold text-ink">
          {showFamily && def.family !== "intl" && (
            <span className="mr-1.5 t-label text-ink-4">{FAMILY_LABEL[def.family]}</span>
          )}
          {showFamily && def.family === "intl" ? fullName : def.name}
        </span>
        {scores.length === 0 ? (
          <span className="shrink-0 t-meta text-ink-4">No Cornell credit at any score</span>
        ) : (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${fullName} score`}>
            {scores.map((s) => {
              const on = picked === s;
              return (
                <Tooltip
                  key={s}
                  content={blocked ? `You've reached ${MAX_CREDIT_ENTRIES} credits — remove one to add another` : undefined}
                >
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${fullName}, score ${s}`}
                  disabled={blocked}
                  onClick={() => onToggle(def.id, s)}
                  className={cn(
                    "num flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border px-1.5 t-body font-bold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                    on
                      ? "border-drop bg-drop text-canvas"
                      : "border-line bg-surface text-ink-2 hover:border-drop hover:bg-drop-tint hover:text-drop-text",
                    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface disabled:hover:text-ink-2"
                  )}
                >
                  {s}
                </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
      {picked !== undefined && (
        <div className="mt-1 flex flex-col gap-0.5" data-exam-result>
          {result ? (
            <p className="flex items-center gap-1 t-body font-medium text-complete-text">
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="num">{awardSummary(result)}</span>
            </p>
          ) : (
            <p className="t-body text-ink-3">{noCreditText(college)}</p>
          )}
          {shown?.note && <p className="t-meta text-ink-3">{shown.note}</p>}
          {shown?.limits.map((l) => (
            <p key={l} className="flex items-start gap-1 t-meta text-ink-3">
              <Info className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span>{l}</span>
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
