import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CountsToward } from "@/lib/schemas";
import { NONE, findOption, toCountsToward, valueOf, type TowardGroup } from "./countsToward";

const SELECT =
  "w-full rounded-md border border-line bg-surface px-2 py-1.5 t-body text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink";

/**
 * Spec 046 D2/D3 — "Counts toward" for a "No Cornell equivalent" transfer:
 * Just credits, one of the college's distribution areas (plus an optional
 * second), or any checkable requirement of the plan's program. A distribution
 * row then asks which area (and an optional second). The student's word is
 * taken as given; the board and Requirements show it as "(you said)".
 *
 * Controlled by `value`; `onChange` gets undefined for Just credits, and also
 * while a distribution row still needs its area (nothing to save yet).
 */
export function CountsTowardPicker({
  groups,
  value,
  onChange,
  compact = false,
  idPrefix,
  name = "Counts toward",
}: {
  groups: TowardGroup[];
  value: CountsToward | undefined;
  /** `incomplete`: a distribution row is chosen but no area yet. */
  onChange: (next: CountsToward | undefined, incomplete: boolean) => void;
  /** The list row's smaller form (no hint lines). */
  compact?: boolean;
  /** Keeps label/select ids unique when several pickers show. */
  idPrefix: string;
  /** The select's accessible name (a list row names its course). */
  name?: string;
}) {
  const saved = valueOf(value);
  // A choice this plan no longer offers keeps showing as "Pick again".
  const [selected, setSelected] = useState(findOption(groups, saved) ? saved : saved === NONE ? NONE : "");
  const [picked, setPicked] = useState<string[]>(
    value?.categories ?? (value?.areas ? value.areas.slice(1) : [])
  );
  const opt = findOption(groups, selected);
  const isArea = selected.startsWith("area:");
  const areaChoices = isArea ? (groups.find((g) => g.options.some((o) => o.value === selected))?.options ?? []) : [];

  const commit = (nextValue: string, nextPicked: string[]) => {
    setSelected(nextValue);
    setPicked(nextPicked);
    const next = toCountsToward(groups, nextValue, nextPicked);
    const chosen = findOption(groups, nextValue);
    onChange(next, !!chosen?.categories && nextPicked.length === 0);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "w-full" : "")}>
      <label className="flex flex-col gap-1">
        <span className={cn("t-meta", compact ? "sr-only" : "text-ink-3")}>Counts toward</span>
        <select
          id={`${idPrefix}-toward`}
          aria-label={name}
          value={selected}
          onChange={(e) => commit(e.target.value, [])}
          className={SELECT}
        >
          {selected === "" && (
            <option value="" disabled>
              Pick again
            </option>
          )}
          {groups.map((g, i) =>
            g.label ? (
              <optgroup key={`${g.label}-${i}`} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            )
          )}
        </select>
      </label>

      {opt?.categories && (
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-meta text-ink-3">Which area?</span>
            <select
              aria-label="Which area?"
              value={picked[0] ?? ""}
              onChange={(e) => commit(selected, e.target.value ? [e.target.value, ...picked.slice(1).filter((p) => p !== e.target.value)] : [])}
              className={SELECT}
            >
              <option value="">Pick an area</option>
              {opt.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {picked[0] && (
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-meta text-ink-3">Second area (optional)</span>
              <select
                aria-label="Second area (optional)"
                value={picked[1] ?? ""}
                onChange={(e) => commit(selected, e.target.value ? [picked[0], e.target.value] : [picked[0]])}
                className={SELECT}
              >
                <option value="">None</option>
                {opt.categories
                  .filter((c) => c.id !== picked[0])
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}

      {isArea && (
        <label className="flex flex-col gap-1">
          <span className="t-meta text-ink-3">Second area (optional)</span>
          <select
            aria-label="Second area (optional)"
            value={picked[0] ? `area:${picked[0]}` : ""}
            onChange={(e) => commit(selected, e.target.value ? [e.target.value.slice("area:".length)] : [])}
            className={SELECT}
          >
            <option value="">None</option>
            {areaChoices
              .filter((o) => o.value !== selected)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </label>
      )}

      {!compact && opt?.seat && (
        <p className="t-meta text-ink-3">
          If it was credited as a Cornell course, search for it instead so prerequisites count too.
        </p>
      )}
      {!compact && selected !== NONE && selected !== "" && (
        <p className="t-meta text-ink-4">It counts there on your board, marked &ldquo;you said&rdquo;.</p>
      )}
    </div>
  );
}
