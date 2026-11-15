import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { OverlapPair } from "@/hooks/useRequirementProgress";
import { useBoard } from "@/hooks/useBoard";
import { useMinorMatch } from "@/hooks/useMajorMatch";
import { closeMinors, minorStanding } from "@/lib/planner/rankMinors";
import { ChangeMajorSelect } from "./ChangeMajorSelect";
import { PROGRAM_BG } from "./programClasses";
import {
  KIND_LABEL,
  doneLine,
  overlapLine,
  type AddAvailability,
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
 * limit (D8). "Minors you're close to" (D11) lists the two minors the plan
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
            notes={overlap.filter((p) => p.b === e.id).map((p) => overlapLine(p, shortNameOf))}
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
  notes,
  onRemove,
  onMajorChanged,
}: {
  entry: ProgramEntry;
  notes: string[];
  onRemove: (id: string) => void;
  onMajorChanged: () => void;
}) {
  const fill = e.status === "ok" ? e.pct : 0;
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
      {notes.map((n) => (
        <p
          key={n}
          data-overlap-line
          className="mt-0.5 rounded-md border border-available bg-available-tint px-2 py-1.5 t-meta leading-snug text-available-text"
        >
          {n}
        </p>
      ))}
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
