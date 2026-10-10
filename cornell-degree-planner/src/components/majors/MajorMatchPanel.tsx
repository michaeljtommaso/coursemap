import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/motion";
import { useMajorMatch, type MajorMatch } from "@/hooks/useMajorMatch";
import { useProgramStore } from "@/store/useProgramStore";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * MajorMatchPanel (spec 011 §2) — the discovery surface, honest by
 * construction. A credit-weighted ranked LIST (not hero-metric cards —
 * PRODUCT.md anti-reference): each major with its credit-weighted percent, a
 * thin rail, and an expansion that EXPLAINS the number — what counted (course →
 * requirement), what's still needed, and which of your placed credits DON'T
 * count toward this major and why. The list reorders with a quiet FLIP as your
 * plan changes (reduced-motion aware); the scope is labelled plainly.
 *
 * What the percent means (B3, spec 014): the share of a major's required
 * credits that the courses on your board — planned OR done, the board is the
 * plan — plus your AP/IB/transfer credit would fill (useMajorMatch). It is a
 * fit/coverage number, not "percent complete": marking a course done doesn't
 * move it. Requirements we can't evaluate client-side stay in the denominator,
 * so no major reads 100% until that data ships.
 */

function reasonText(reason: MajorMatch["uncounted"][number]["reason"]): string {
  return reason === "no-requirement-matched"
    ? "doesn't match any requirement"
    : "requirement already filled";
}

function MatchRow({
  rank,
  match,
  isCurrent,
}: {
  rank: number;
  match: MajorMatch;
  isCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { program, pct, creditsSatisfied, creditsRequired, matched, missing, uncounted } = match;
  const name = program.short_name ?? program.name;
  const uncountedCredits = uncounted.reduce((sum, u) => sum + u.credits, 0);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="num t-meta w-4 shrink-0 text-ink-4">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate t-body font-semibold">{name}</span>
            {isCurrent && <span className="t-meta text-ink-4">your plan</span>}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-complete transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
        <span className="num t-body w-10 shrink-0 text-right font-semibold">{pct}%</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-line px-3 py-2.5">
          <p className="t-meta">
            <span className="num">{creditsSatisfied}</span> of{" "}
            <span className="num">{creditsRequired}</span> credits count toward {name}.
          </p>

          {matched.length > 0 && (
            <div>
              <p className="mb-1 t-label">What counts</p>
              <ul className="flex flex-col gap-0.5">
                {matched.slice(0, 8).map((m) => (
                  <li key={`${m.courseId}:${m.requirementId}`} className="flex items-baseline gap-1.5 t-meta">
                    <span className="num shrink-0 text-complete-text">{m.code}</span>
                    <span className="shrink-0 text-ink-4">→</span>
                    <span className="truncate text-ink-2" title={m.requirementLabel}>
                      {m.requirementLabel}
                    </span>
                  </li>
                ))}
                {matched.length > 8 && (
                  <li className="t-meta text-ink-4">
                    +<span className="num">{matched.length - 8}</span> more
                  </li>
                )}
              </ul>
            </div>
          )}

          {missing.length > 0 && (
            <div>
              <p className="mb-1 t-label">Still needed</p>
              <ul className="flex flex-col gap-0.5">
                {missing.slice(0, 6).map((m) => (
                  <li key={m.requirementId} className="flex items-baseline justify-between gap-2 t-meta">
                    <span className="truncate text-ink-2" title={m.label}>
                      {m.label}
                    </span>
                    <span className="shrink-0 text-ink-4">
                      {m.reason === "no-data" ? (
                        "needs data we don't have yet"
                      ) : (
                        <>
                          <span className="num">{m.credits}</span> cr
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {missing.length > 6 && (
                  <li className="t-meta text-ink-4">
                    +<span className="num">{missing.length - 6}</span> more
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* The explanation block (spec 011 §1c) — the honest "here's what's
              NOT counting and why". Literally a render of the matcher's
              `uncounted`; no separate math. */}
          {uncounted.length > 0 && (
            <div className="rounded-md bg-surface-2/60 px-2 py-1.5">
              <p className="mb-1 t-meta text-ink-2">
                <span className="num">{uncountedCredits}</span> credit
                {uncountedCredits === 1 ? "" : "s"} on your plan don&apos;t count toward {name}.
              </p>
              <ul className="flex flex-col gap-0.5">
                {uncounted.slice(0, 6).map((u) => (
                  <li key={u.courseId} className="flex items-baseline justify-between gap-2 t-meta">
                    <span className="num shrink-0 text-ink-3">{u.code}</span>
                    <span className="truncate text-right text-ink-4" title={u.title}>
                      {reasonText(u.reason)}
                    </span>
                  </li>
                ))}
                {uncounted.length > 6 && (
                  <li className="t-meta text-ink-4">
                    +<span className="num">{uncounted.length - 6}</span> more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MajorMatchPanel({ slots }: { slots: ProgramSlotWithData[] }) {
  const { matches, ready } = useMajorMatch(slots);
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const anySignal = matches.some((m) => m.creditsSatisfied > 0);

  // FLIP reorder: as the plan changes the ranking reshuffles — animate each row
  // from its previous position to its new one (the app's anime.js idiom; the
  // `y` shorthand + from-array matches RightSidebar/SlotCard). Reduced-motion
  // skips the motion but keeps a fresh baseline for a later motion-on run.
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const next = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      if (reduce) return;
      const old = prevRects.current.get(id);
      if (old) {
        const dy = old.top - rect.top;
        if (Math.abs(dy) > 1) animate(el, { y: [dy, 0], duration: 420, ease: "out(3)" });
      }
    });
    prevRects.current = next;
  }, [matches]);

  const registerRow = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="mb-1 t-label">Major Match</p>
        <p className="t-meta">
          {anySignal
            ? "How much of each major's required credits the courses on your board (planned or done) and your credit would cover. Every major is scored the same way."
            : "Add a few courses and each major's fit shows up here, weighted by credits."}
        </p>
      </div>

      {!ready ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-lg border border-line bg-surface-2/50" />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {matches.map((m, i) => (
            <div key={m.program.id} ref={registerRow(m.program.id)}>
              <MatchRow rank={i + 1} match={m} isCurrent={m.program.id === selectedProgramId} />
            </div>
          ))}
          <p className="t-meta px-1 pt-0.5 text-ink-4">
            Ranked across every major we have. A high match elsewhere means your
            interests already point there — switching keeps this plan safe.
          </p>
        </div>
      )}
    </div>
  );
}
