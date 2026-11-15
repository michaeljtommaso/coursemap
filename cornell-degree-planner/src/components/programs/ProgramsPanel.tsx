import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { OverlapPair } from "@/hooks/useRequirementProgress";
import { useBoard } from "@/hooks/useBoard";
import { useMinorMatch } from "@/hooks/useMajorMatch";
import { usePlan } from "@/hooks/usePlan";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { useMakeRoom } from "@/components/requirements/orphanPrune";
import { programLayerId } from "@/components/requirements/programSections";
import { countsForKey } from "@/lib/planner/questions/keys";
import { closeMinors, minorStanding } from "@/lib/planner/rankMinors";
import { ChangeMajorSelect } from "./ChangeMajorSelect";
import { ConcentrationChooser } from "./ConcentrationChooser";
import { useSecondMajorConcentration } from "./useSecondMajorConcentration";
import { PROGRAM_BG } from "./programClasses";
import {
  HELD_BACK_HINT,
  KIND_LABEL,
  doneLine,
  heldBackToggles,
  overlapLine,
  type AddAvailability,
  type HeldBackToggle,
  type ProgramEntry,
} from "./programsModel";

export type ProgramsPanelProps = {
  id: string;
  /** The primary first, then the extra programs in the order added. */
  entries: ProgramEntry[];
  overlap: OverlapPair[];
  add: { major: AddAvailability; minor: AddAvailability };
  shortNameOf: (id: string) => string;
  onAdd: (kind: "major" | "minor") => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** "Try it" on a minor you're close to (D11): the stack's add flow. Absent
   *  → no "Minors you're close to" block. */
  onTryMinor?: (minor: { id: string; shortName: string }) => void;
};

/**
 * "Your programs" (spec 047 D5), opened from any stack segment: each program
 * with its kind, a bar and "N of M done"; × removes an extra program (soft
 * remove with undo, D10); the primary's row has "Change major" (the old
 * select). The overlap line sits under the later program of each pair with a
 * limit (D8), and under it one either/or toggle per held-back course naming
 * both programs, the one it counts for now pressed (D8). The second major's
 * row carries its concentration chooser (D2) when its layers offer any; a
 * minor a major on the plan isn't open to shows that warning in place of
 * "N of M done" (D12). "Minors you're close to" (D11) lists the two minors the plan
 * is fewest classes from finishing (at most three, a proven count), each with
 * "Try it"; it shows nothing while they're ranked and nothing when none is
 * close.
 */
export const ProgramsPanel = forwardRef<HTMLDivElement, ProgramsPanelProps>(function ProgramsPanel(
  { id, entries, overlap, add, shortNameOf, onAdd, onRemove, onClose, onTryMinor },
  ref
) {
  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Your programs"
      tabIndex={-1}
      data-programs-panel
      className="absolute right-0 top-full z-[var(--z-sidebar-panel)] mt-1.5 flex w-[440px] flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-xl outline-none"
    >
      <div className="flex items-baseline justify-between">
        <p className="t-body font-bold tracking-tight">Your programs</p>
        <Link to="/requirements" onClick={onClose} className="t-meta text-drop-text underline-offset-2 hover:underline">
          Open requirements
        </Link>
      </div>

      <div className="flex flex-col gap-2.5">
        {entries.map((e) => (
          <ProgramRow
            key={e.id}
            entry={e}
            pairs={overlap.filter((p) => p.b === e.id)}
            shortNameOf={shortNameOf}
            onRemove={onRemove}
            onMajorChanged={onClose}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AddButton availability={add.major} onClick={() => onAdd("major")} dataId="add-second-major" />
        <AddButton availability={add.minor} onClick={() => onAdd("minor")} dataId="add-minor" />
      </div>

      {onTryMinor && <MinorsCloseTo canAdd={add.minor.enabled} onTry={onTryMinor} />}
    </div>
  );
});

function ProgramRow({
  entry: e,
  pairs,
  shortNameOf,
  onRemove,
  onMajorChanged,
}: {
  entry: ProgramEntry;
  pairs: OverlapPair[];
  shortNameOf: (id: string) => string;
  onRemove: (id: string) => void;
  onMajorChanged: () => void;
}) {
  const fill = e.status === "ok" && !e.warning ? e.pct : 0;
  return (
    <div data-program-row={e.id} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", e.color ? PROGRAM_BG[e.color] : "bg-ink")} />
        <span className="min-w-0 truncate t-body font-semibold">{e.name}</span>
        <span className="shrink-0 t-meta text-ink-3">{KIND_LABEL[e.kind]}</span>
        <span className="ml-auto shrink-0 t-meta text-ink-2">{doneLine(e)}</span>
        {e.kind === "primary" ? (
          <ChangeMajorSelect onChanged={onMajorChanged} />
        ) : (
          <Tooltip content={`Remove ${e.shortName}`} placement="bottom">
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              aria-label={`Remove ${e.kind === "minor" ? `${e.name} minor` : e.name}`}
              className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={`${e.shortName} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        className="h-1.5 overflow-hidden rounded-[3px] bg-surface-2"
      >
        <div
          className={cn("h-full", e.color ? PROGRAM_BG[e.color] : "bg-ink")}
          style={{ width: `${fill}%` }}
        />
      </div>
      {e.warning && (
        <p
          data-program-warning
          role="note"
          className="mt-0.5 rounded-md border border-available bg-available-tint px-2 py-1.5 t-meta leading-snug text-available-text"
        >
          {e.warning}
        </p>
      )}
      {e.kind === "secondMajor" && <SecondMajorConcentration programId={e.id} />}
      {pairs.map((p) => (
        <div key={`${p.a}|${p.b}`} data-overlap-pair className="mt-0.5 flex flex-col gap-1.5">
          <p
            data-overlap-line
            className="rounded-md border border-available bg-available-tint px-2 py-1.5 t-meta leading-snug text-available-text"
          >
            {overlapLine(p, shortNameOf)}
          </p>
          {p.heldBack.length > 0 && <HeldBackToggles pair={p} shortNameOf={shortNameOf} />}
        </div>
      ))}
    </div>
  );
}

/** D2: the second major's concentration chooser, when it offers any. */
function SecondMajorConcentration({ programId }: { programId: string }) {
  const { choice, choose } = useSecondMajorConcentration();
  if (!choice || choice.programId !== programId) return null;
  return <ConcentrationChooser choice={choice} onChange={choose} />;
}

/** D8: each held-back course under its pair as an either/or toggle naming
 *  both programs. Clicking the other side counts it there (the D10 cap guard
 *  first); the pressed side does nothing. Mounted only for a pair with
 *  held-back courses while the panel is open. */
function HeldBackToggles({ pair, shortNameOf }: { pair: OverlapPair; shortNameOf: (id: string) => string }) {
  const progress = useRequirementProgress();
  const { setCountsFor } = usePlan();
  const makeRoom = useMakeRoom(progress);
  const toggles = heldBackToggles(pair, shortNameOf, (id) => programLayerId(progress.groups, id));
  if (toggles.length === 0) return null;
  const choose = (t: HeldBackToggle) => {
    makeRoom("mark", countsForKey(t.switchTo, t.courseId), "yes");
    setCountsFor(t.courseId, t.switchTo);
  };
  return (
    <div data-held-back-toggles className="flex flex-col gap-1">
      {toggles.map((t) => (
        <div key={t.courseId} data-held-back-toggle={t.courseId} className="flex items-center gap-2">
          <span className="shrink-0 t-meta font-semibold text-ink">{t.code}</span>
          <div
            role="group"
            aria-label={`Which program ${t.code} counts for`}
            className="ml-auto grid min-w-0 grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-0.5"
          >
            {t.sides.map((s) => (
              <button
                key={s.id}
                type="button"
                data-counts-for-side={s.id}
                aria-pressed={s.current}
                aria-label={`Count ${t.code} for ${s.name}`}
                onClick={s.current ? undefined : () => choose(t)}
                className={cn(
                  "h-6 min-w-0 truncate rounded-md px-2 t-meta font-semibold transition-colors",
                  s.current ? "cursor-default bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p data-held-back-hint className="t-meta text-ink-3">
        {HELD_BACK_HINT}
      </p>
    </div>
  );
}

/** "Minors you're close to" (D11): the top two of Major Match's Minors
 *  ranking. Mounted only while the panel is open, so minor layers are read
 *  only then (session-cached). */
function MinorsCloseTo({
  canAdd,
  onTry,
}: {
  canAdd: boolean;
  onTry: (minor: { id: string; shortName: string }) => void;
}) {
  const { cards } = useBoard();
  const { matches, ready } = useMinorMatch(cards, { enabled: true });
  const close = ready ? closeMinors(matches) : [];
  if (close.length === 0) return null;
  return (
    <div data-minors-close className="flex flex-col gap-1 border-t border-line-faint pt-2.5">
      <p className="t-label">Minors you&apos;re close to</p>
      {close.map((m) => (
        <div key={m.entry.id} data-close-minor={m.entry.id} className="flex items-center gap-2 py-1.5">
          <span className="min-w-0 truncate t-body font-medium">{m.entry.name}</span>
          <span className="shrink-0 t-meta text-ink-3">{minorStanding(m)}</span>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => onTry({ id: m.entry.id, shortName: m.entry.shortName })}
            aria-label={`Try the ${m.entry.name} minor`}
            className="ml-auto h-[26px] shrink-0 rounded-[7px] border border-line bg-surface px-2.5 t-meta font-semibold text-ink transition-colors hover:bg-surface-2 disabled:cursor-default disabled:border-line-faint disabled:bg-canvas disabled:text-ink-4"
          >
            Try it
          </button>
        </div>
      ))}
    </div>
  );
}

function AddButton({ availability, onClick, dataId }: { availability: AddAvailability; onClick: () => void; dataId: string }) {
  return (
    <button
      type="button"
      data-add={dataId}
      disabled={!availability.enabled}
      onClick={onClick}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 t-meta font-semibold text-ink transition-colors hover:bg-surface-2 disabled:cursor-default disabled:border-line-faint disabled:bg-canvas disabled:text-ink-4"
    >
      <Plus className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{availability.label}</span>
    </button>
  );
}
