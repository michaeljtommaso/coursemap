/**
 * The journey as one line plus its bar (spec 025 D9): "16 of 120 credits" and
 * the percentage. Credits in progress get a second short line only when there
 * are any.
 */
export function RailJourney({
  hasProgram,
  earned,
  inProgress,
  total,
}: {
  hasProgram: boolean;
  earned: number;
  inProgress: number;
  total: number;
}) {
  if (!hasProgram) {
    return <p className="t-meta text-ink-3">Pick a program and this becomes your road home.</p>;
  }
  const pct = total > 0 ? Math.min(100, Math.round((earned / total) * 100)) : 0;
  return (
    <section data-rail-journey className="flex flex-col gap-1">
      <p className="flex items-baseline justify-between gap-2 t-body">
        <span className="font-semibold">
          <span className="num">{earned}</span> of <span className="num">{total}</span> credits
        </span>
        <span className="num t-meta text-ink-3">{pct}%</span>
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-complete transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {inProgress > 0 && (
        <p className="t-meta text-ink-3">
          <span className="num">{inProgress}</span> more in progress
        </p>
      )}
    </section>
  );
}
