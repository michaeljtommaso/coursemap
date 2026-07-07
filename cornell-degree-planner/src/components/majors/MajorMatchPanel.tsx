import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMajorMatch } from "@/hooks/useMajorMatch";
import { useProgramStore } from "@/store/useProgramStore";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * MajorMatchPanel (spec 004 §5 / 005 §2) — the differentiator, finally real.
 * A ranked LIST (deliberately not hero-metric cards — PRODUCT.md anti-
 * reference): each major, its match percent in mono, a thin rail, and an
 * expandable detail of what matched and what's still missing.
 */

function MatchRow({
  rank,
  name,
  shortName,
  pct,
  matched,
  required,
  matchedCourses,
  missing,
  electiveFit,
  isCurrent,
}: {
  rank: number;
  name: string;
  shortName: string | null;
  pct: number;
  matched: number;
  required: number;
  matchedCourses: { id: string; code: string; title: string }[];
  missing: { id: string; code: string; title: string }[];
  electiveFit: number;
  isCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);

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
            <span className="truncate t-body font-semibold">
              {shortName ?? name}
            </span>
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
        <div className="flex flex-col gap-2 border-t border-line/70 px-3 py-2.5">
          <p className="t-meta">
            <span className="num">{matched}</span> of <span className="num">{required}</span>{" "}
            required courses are in your plan
            {electiveFit > 0 && (
              <>
                {" "}— and <span className="num">{electiveFit}</span> of your courses
                would fit its electives
              </>
            )}
            .
          </p>
          {matchedCourses.length > 0 && (
            <div>
              <p className="mb-1 t-label">In your plan</p>
              <div className="flex flex-wrap gap-1">
                {matchedCourses.slice(0, 8).map((c) => (
                  <span
                    key={c.id}
                    title={c.title}
                    className="rounded border border-complete/40 bg-complete-tint px-1.5 py-0.5 t-meta text-complete-text"
                  >
                    {c.code}
                  </span>
                ))}
                {matchedCourses.length > 8 && (
                  <span className="t-meta text-ink-4">
                    +<span className="num">{matchedCourses.length - 8}</span> more
                  </span>
                )}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <div>
              <p className="mb-1 t-label">Would still need</p>
              <div className="flex flex-wrap gap-1">
                {missing.slice(0, 6).map((c) => (
                  <span
                    key={c.id}
                    title={c.title}
                    className="rounded border border-line bg-surface-2/60 px-1.5 py-0.5 t-meta text-ink-2"
                  >
                    {c.code}
                  </span>
                ))}
                {missing.length > 6 && (
                  <span className="t-meta text-ink-4">
                    +<span className="num">{missing.length - 6}</span> more
                  </span>
                )}
              </div>
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
  const anySignal = matches.some((m) => m.matched > 0);

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="mb-1 t-label">Major Match</p>
        <p className="t-meta">
          {anySignal
            ? "Based on what you've completed and planned — it updates as you go."
            : "Complete or place a few courses and each major's fit shows up here."}
        </p>
      </div>

      {!ready ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-lg border border-line bg-surface-2/50" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {matches.map((m, i) => (
            <MatchRow
              key={m.program.id}
              rank={i + 1}
              name={m.program.name}
              shortName={m.program.short_name}
              pct={m.pct}
              matched={m.matched}
              required={m.required}
              matchedCourses={m.matchedCourses}
              missing={m.missing}
              electiveFit={m.electiveFit}
              isCurrent={m.program.id === selectedProgramId}
            />
          ))}
          <p className="t-meta px-1 text-ink-4">
            A high match on another major means your interests already point
            there — switching programs keeps this plan safe.
          </p>
        </div>
      )}
    </div>
  );
}
