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
 * One exam (spec 028 D6, spec 045 D4): its name, what the picked score earns,
 * then a toggle button per score that earns something in some college. Click
 * a score to pick it, click it again to clear, click another to switch. A
 * picked row says what it earns for this student's college, with any limits
 * underneath; the college's own limits are left to the side list.
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
  collegeLimits,
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
  /** The college's own limits: shown once by the host, so dropped here. */
  collegeLimits?: readonly string[];
}) {
  const earning = scoresThatEarn(def.id, tables);
  // A saved score that no longer earns anywhere still shows, so it can be
  // cleared; the order stays the exam's scale (lowest first).
  const scores = def.scale.filter((s) => earning.includes(s) || s === picked);
  const fullName = examDisplayName(def);
  const result = picked ? examResult(def.id, picked, college, tables) : null;
  // Fills describe the saved score; a different pick in the editor isn't placed yet.
  const filled = fills && fills.score === picked ? fills.requirements : undefined;
  const shown = result
    ? visibleCreditText(
        { ...result, limits: result.limits.filter((l) => !collegeLimits?.includes(l)) },
        major,
        filled
      )
    : null;
  const blocked = newPicksBlocked && picked === undefined;

  return (
    <li
      data-exam={def.id}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] items-center gap-x-4 rounded-lg border px-3 py-2.5 transition-colors",
        picked ? "border-drop/60 bg-drop-tint/50" : "border-transparent hover:bg-surface-2/70"
      )}
    >
      <span className="min-w-0 t-body font-semibold text-ink">
        {showFamily && def.family !== "intl" && (
          <span className="mr-1.5 t-label text-ink-4">{FAMILY_LABEL[def.family]}</span>
        )}
        {showFamily && def.family === "intl" ? fullName : def.name}
      </span>

      {picked !== undefined ? (
        <div className="flex min-w-0 flex-col gap-0.5" data-exam-result>
          {result ? (
            <p className="flex items-center gap-1 t-body font-semibold text-complete-text">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="num">{awardSummary(result)}</span>
            </p>
          ) : (
            <p className="t-body text-ink-3">{noCreditText(college)}</p>
          )}
          {shown?.note && <p className="t-meta text-ink-3">{shown.note}</p>}
          {shown?.limits.map((l) => (
            <p key={l} className="flex items-start gap-1 t-meta text-ink-3">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{l}</span>
            </p>
          ))}
        </div>
      ) : scores.length === 0 ? (
        <span className="t-meta text-ink-4">No Cornell credit at any score</span>
      ) : (
        <span aria-hidden="true" />
      )}

      {scores.length === 0 ? (
        <span aria-hidden="true" />
      ) : (
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={`${fullName} score`}>
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
                    "num flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border px-2 t-body font-bold transition-colors",
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
    </li>
  );
}
