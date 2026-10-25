import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { isDistributionFamily, programFamily, type ProgramFamily } from "@/lib/planner/colleges";
import {
  START_YEAR_OPTIONS,
  entryTermFrom,
  guessEntryFromEnteringYear,
  parseEntryTerm,
  type EntrySeason,
} from "@/lib/planner/entryTerm";
import {
  answersToSave,
  nextQuestion,
  type QuestionDraft,
  type StudentContextNeed,
} from "@/lib/planner/studentQuestions";
import type { ClassStanding, TransferKind } from "@/lib/planner/distribution/types";
import { choicePillClass } from "./choicePill";

export type { StudentContextNeed };

/**
 * StudentContextQuestions (spec 019 D10, Phase 2 deviation 7) — asks what
 * selectLayers needs: the start term, whether the student transferred in, and
 * the class standing a transfer arrived at. Writes through
 * useAuth().setStudentContext; never guesses an answer.
 *
 * Used by FirstRun and, inline, by the Requirements panel when a Distribution
 * program's selection needs an answer (RequirementProgress.notice). Which
 * question comes next is decided in lib/planner/studentQuestions.ts; answers
 * are saved together once the asked questions are done (a student who backs
 * out halfway saves nothing). A start term also sets `enteringYear`, which
 * labels the semesters (lib/planner/entryTerm.ts maps a spring start).
 */

const SEASONS: { id: EntrySeason; label: string }[] = [
  { id: "FA", label: "Fall" },
  { id: "SP", label: "Spring" },
];

const TRANSFER_OPTIONS: { id: TransferKind; label: string }[] = [
  { id: "none", label: "No" },
  { id: "external", label: "From another school" },
  { id: "internal", label: "From another Cornell college" },
];

const STANDING_OPTIONS: { id: ClassStanding; label: string }[] = [
  { id: "first-year", label: "First-year" },
  { id: "sophomore", label: "Sophomore" },
  { id: "junior", label: "Junior" },
  { id: "senior", label: "Senior" },
];

export function StudentContextQuestions(props: {
  /** Ask only this question (the panel's inline use); absent → ask every
   *  question still unanswered, in order. */
  need?: StudentContextNeed;
  /** Inline panel styling (tight, no heading). */
  compact?: boolean;
  /** Called once the asked question(s) are answered and saved. */
  onDone?: () => void;
  /** The program family the answers are for (FirstRun passes the major being
   *  picked); defaults to the selected program's. Transfer questions are only
   *  asked for Arts & Sciences / CALS. */
  family?: ProgramFamily;
}) {
  const { need, compact = false, onDone, family } = props;
  const { studentContext, enteringYear, setStudentContext, setEnteringYear } = useAuth();
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const askTransfer = isDistributionFamily(
    family ?? programFamily(programs.find((p) => p.id === selectedProgramId))
  );

  // What the profile held when the questions opened: saving an answer must
  // not reshuffle the questions mid-run.
  const [known] = useState(studentContext);
  const [knownYear] = useState(enteringYear);
  const [draft, setDraft] = useState<QuestionDraft>({});
  const question = nextQuestion({ need, known, enteringYear: knownYear, askTransfer, draft });

  // A start already on file (or a pre-start-term year) is PRE-SELECTED only;
  // nothing is saved until the student picks.
  const guess = parseEntryTerm(known.entryTerm) ?? guessEntryFromEnteringYear(knownYear);
  const [season, setSeason] = useState<EntrySeason>(guess?.season ?? "FA");

  // Every asked question answered → save the answers together, then hand back.
  // Fire-and-forget like FirstRun's year write: setStudentContext waits for a
  // brand-new profile in the background, so first run never stalls on it.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (question !== null) {
      // A new `need` reopened the questions (the panel asks for the standing
      // after "From another school"): save again once it's answered.
      finishedRef.current = false;
      return;
    }
    if (finishedRef.current) return;
    finishedRef.current = true;
    const { prefs, enteringYear: year } = answersToSave(draft);
    if (Object.keys(prefs).length > 0) void setStudentContext(prefs);
    if (year != null) void setEnteringYear(year);
    onDone?.();
  }, [question, draft, setStudentContext, setEnteringYear, onDone]);

  if (question === null) return null;

  const answer = (patch: QuestionDraft) => setDraft((d) => ({ ...d, ...patch }));

  const prompt = (text: React.ReactNode, hint?: string) => (
    <div className={cn("flex flex-col gap-1", !compact && "items-center text-center")}>
      <p className={compact ? "t-meta text-ink-2" : "t-body text-ink-2"}>{text}</p>
      {hint && !compact && <p className="t-meta text-ink-3">{hint}</p>}
    </div>
  );
  const row = cn("flex flex-wrap gap-2", !compact && "justify-center");

  return (
    <div className={cn("flex flex-col", compact ? "items-start gap-2" : "items-center gap-4")}>
      {question === "entry-term" && (
        <>
          {prompt(
            compact ? (
              "When did you start at Cornell?"
            ) : (
              <>
                When did you start at Cornell? We&apos;ll label the semesters as
                <em> your</em> semesters.
              </>
            )
          )}
          <div
            role="group"
            aria-label="Start term"
            className="flex rounded-lg border border-line bg-surface-2/70 p-0.5"
          >
            {SEASONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSeason(s.id)}
                aria-pressed={season === s.id}
                className={cn(
                  "rounded-md border px-3 py-1 t-label transition-colors",
                  season === s.id
                    ? "border-line bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:text-ink"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className={row}>
            {START_YEAR_OPTIONS.map((y) => {
              const label = `${season === "FA" ? "Fall" : "Spring"} ${y}`;
              const preselected = guess?.season === season && guess.year === y;
              return (
                <button
                  key={y}
                  onClick={() => answer({ entryTerm: entryTermFrom(season, y) })}
                  className={choicePillClass(preselected, compact)}
                >
                  <span className="num">{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {question === "transfer" && (
        <>
          {prompt("Did you transfer to Cornell?", "Some college requirements depend on how you arrived.")}
          <div className={row}>
            {TRANSFER_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => answer({ transfer: o.id })}
                className={choicePillClass(false, compact)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      {question === "transfer-standing" && (
        <>
          {prompt("What class standing did you arrive with?")}
          <div className={row}>
            {STANDING_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => answer({ transferStanding: o.id })}
                className={choicePillClass(false, compact)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
