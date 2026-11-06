import { useState } from "react";
import { RotateCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import type { CreditEntry } from "@/lib/schemas";
import type { Course } from "@/types/db";
import { formatCredits } from "./examDisplay";
import { newTransferId } from "./creditDraft";

/**
 * Adding one transfer course (spec 028 D2). Default: search the catalog for
 * the Cornell course it was credited as; credits prefill from the course and
 * stay editable. "No Cornell equivalent" swaps to a label + credits form.
 */

const INPUT =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 t-body outline-none placeholder:text-ink-4 focus:border-ink focus:ring-1 focus:ring-ink";

/** Credits a transfer entry may carry (CreditEntrySchema: 0–20). */
function parseCredits(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

const code = (c: Course) => `${c.subject} ${c.number}`;

export function TransferForm({
  takenIds,
  onAdd,
  onCancel,
}: {
  takenIds: string[];
  onAdd: (entry: CreditEntry) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"search" | "none">("search");
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [credits, setCredits] = useState("");
  const [label, setLabel] = useState("");
  const [tried, setTried] = useState(false);
  const { results, loading, error, refetch } = useCourseSearch(mode === "search" && !course ? query : "");

  const pickCourse = (c: Course) => {
    setCourse(c);
    setCredits(formatCredits(c.credits_min || c.credits_max || 0));
    setTried(false);
  };

  const parsed = parseCredits(credits);
  const labelOk = mode === "search" || label.trim().length > 0;
  const ready = parsed !== null && labelOk && (mode === "none" || course !== null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in the search box picks the top match.
    if (mode === "search" && !course && query.trim() && results.length > 0) {
      pickCourse(results[0]);
      return;
    }
    setTried(true);
    if (!ready || parsed === null) return;
    const name = label.trim();
    const entryLabel =
      mode === "none"
        ? name
        : name
          ? `${name} (as ${code(course!)})`
          : `${code(course!)} (transfer)`;
    onAdd({
      id: newTransferId(takenIds),
      kind: "transfer",
      label: entryLabel.slice(0, 80),
      satisfiesCourseIds: mode === "none" ? [] : [course!.id],
      credits: parsed,
    });
  };

  const switchMode = (m: "search" | "none") => {
    setMode(m);
    setCourse(null);
    setCredits("");
    setLabel("");
    setTried(false);
  };

  const creditsField = (
    <label className="flex w-24 shrink-0 flex-col gap-1">
      <span className="t-meta text-ink-3">Credits</span>
      <input
        type="number"
        inputMode="decimal"
        min={0.5}
        max={20}
        step={0.5}
        value={credits}
        onChange={(e) => setCredits(e.target.value)}
        aria-invalid={tried && parsed === null}
        className={cn(INPUT, "num")}
      />
    </label>
  );

  return (
    <form
      onSubmit={submit}
      aria-label="Add a transfer course"
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-2/50 p-3"
    >
      {mode === "search" && !course && (
        <>
          <label className="flex flex-col gap-1">
            <span className="t-meta text-ink-3">Which Cornell course was it credited as?</span>
            <span className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4"
                aria-hidden="true"
              />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="MATH 1910, Intro Psychology…"
                aria-label="Search Cornell courses"
                className={cn(INPUT, "pl-8")}
              />
            </span>
          </label>
          {error ? (
            <p className="flex items-center gap-2 t-meta text-destructive-text">
              Couldn&apos;t load the course list.
              <button
                type="button"
                onClick={refetch}
                className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                <RotateCw className="h-3 w-3" aria-hidden="true" /> Try again
              </button>
            </p>
          ) : loading && query.trim() ? (
            <p className="t-meta text-ink-4">Loading the course list…</p>
          ) : query.trim() && results.length === 0 ? (
            <p className="t-meta text-ink-4">No Cornell course matches. Try its code, like MATH 1910.</p>
          ) : (
            results.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto" aria-label="Matching courses">
                {results.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickCourse(c)}
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-drop-tint"
                    >
                      <span className="shrink-0 t-body font-semibold text-ink">{code(c)}</span>
                      <span className="min-w-0 flex-1 truncate t-body text-ink-2">{c.title}</span>
                      <span className="num shrink-0 t-meta text-ink-3">
                        {c.credits_min === c.credits_max
                          ? formatCredits(c.credits_min)
                          : `${formatCredits(c.credits_min)}–${formatCredits(c.credits_max)}`}{" "}
                        cr
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}

      {mode === "search" && course && (
        <>
          <div className="flex items-center gap-2 rounded-md border border-drop/60 bg-drop-tint/60 px-2.5 py-1.5">
            <span className="t-body font-semibold text-ink">{code(course)}</span>
            <span className="min-w-0 flex-1 truncate t-body text-ink-2">{course.title}</span>
            <button
              type="button"
              onClick={() => setCourse(null)}
              className="shrink-0 t-meta text-ink-3 underline-offset-2 hover:underline"
            >
              Change
            </button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-meta text-ink-3">Name at your other school (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="e.g. Calculus II, Ithaca College"
                className={INPUT}
              />
            </label>
            {creditsField}
          </div>
        </>
      )}

      {mode === "none" && (
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-meta text-ink-3">Course name</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. Intro to Film, Tompkins Cortland CC"
              aria-invalid={tried && !labelOk}
              className={INPUT}
            />
          </label>
          {creditsField}
        </div>
      )}

      {tried && !ready && (
        <p className="t-meta text-destructive-text" role="alert">
          {mode === "search" && !course
            ? "Pick the Cornell course first."
            : !labelOk
              ? "Give the course a name."
              : "Credits must be a number from 0.5 to 20."}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => switchMode(mode === "search" ? "none" : "search")}
          className="t-meta text-ink-3 underline-offset-2 hover:underline"
        >
          {mode === "search" ? "No Cornell equivalent" : "Search Cornell courses instead"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md px-2.5 py-1.5 t-body font-semibold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-ink px-3 py-1.5 t-body font-semibold text-canvas transition-colors hover:opacity-90"
        >
          Add course
        </button>
      </div>
    </form>
  );
}
