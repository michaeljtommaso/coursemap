import { useMinorMatch, type MinorMatch } from "@/hooks/useMajorMatch";
import { usePlan } from "@/hooks/usePlan";
import { useRequirementProgress } from "@/hooks/useRequirementProgress";
import { useProgramFlows } from "@/components/programs/useProgramFlows";
import { Tooltip } from "@/components/ui/Tooltip";
import { MAX_MINORS } from "@/lib/schemas";
import { minorStanding } from "@/lib/planner/rankMinors";
import type { BoardCard } from "@/lib/planner/board";

/**
 * The Minors tab of Major Match (spec 047 D11): every minor the student can
 * take, ranked by how many classes they are from finishing it. A count the
 * engine can't prove shows the minor's percent instead (rankMinors.ts fails
 * closed). "Try it" adds the minor through the stack's add flow (D3): its
 * still-needed required classes go to Tried once it is solved.
 *
 * Mounted only while the tab is open; `enabled` is false while the drawer is
 * collapsed, so minor layers load only when the list is on screen.
 */
export function MinorMatchList({ cards, enabled }: { cards: BoardCard[]; enabled: boolean }) {
  const { matches, ready, needsMajor, error } = useMinorMatch(cards, { enabled });
  const { additionalPrograms } = usePlan();
  const progress = useRequirementProgress();
  const { add } = useProgramFlows(progress);
  const atCap = additionalPrograms.filter((p) => p.kind === "minor").length >= MAX_MINORS;

  if (needsMajor) {
    return <p className="t-meta px-1">Choose a major first, and the minors you&apos;re closest to show up here.</p>;
  }
  if (!ready) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true" data-minor-match-loading>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[52px] animate-pulse rounded-lg border border-line bg-surface-2/50" />
        ))}
      </div>
    );
  }
  if (error) return <p className="t-meta px-1">Couldn&apos;t load the minors right now.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {matches.map((m) => (
        <MinorRow
          key={m.entry.id}
          match={m}
          atCap={atCap}
          onTry={() => add({ programId: m.entry.id, kind: "minor", shortName: m.entry.shortName })}
        />
      ))}
      {matches.length === 0 && <p className="t-meta px-1">No minors to compare here yet.</p>}
      <p className="t-meta px-1 pt-0.5 text-ink-4">
        Classes away counts the fewest more classes that would finish each minor. When we can&apos;t be sure of that
        number, you see how much of the minor is done instead.
      </p>
    </div>
  );
}

function MinorRow({ match: m, atCap, onTry }: { match: MinorMatch; atCap: boolean; onTry: () => void }) {
  const standing = minorStanding(m);
  const button = (
    <button
      type="button"
      data-try-minor={m.entry.id}
      disabled={atCap}
      onClick={onTry}
      aria-label={`Try the ${m.entry.name} minor`}
      className="h-[26px] shrink-0 rounded-[7px] border border-line bg-surface px-2.5 t-meta font-semibold text-ink transition-colors hover:bg-surface-2 disabled:cursor-default disabled:border-line-faint disabled:bg-canvas disabled:text-ink-4"
    >
      Try it
    </button>
  );
  return (
    <div data-minor-row={m.entry.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate t-body font-semibold">{m.entry.name}</span>
        <span className="block truncate t-meta text-ink-4">{m.entry.offeredBy}</span>
      </span>
      <span
        data-minor-standing
        className={m.classesAway == null ? "num shrink-0 t-meta text-ink-3" : "num shrink-0 t-meta font-semibold text-ink-2"}
      >
        {standing}
      </span>
      {atCap ? (
        <Tooltip content="A plan holds three minors" placement="bottom">
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
