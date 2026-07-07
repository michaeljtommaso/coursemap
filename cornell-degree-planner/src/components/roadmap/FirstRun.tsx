import { useState } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import type { Program } from "@/types/db";

/**
 * FirstRun (spec 004 §3) — the empty canvas is the pitch, not a shrug.
 * Thesis line, program pill cards rendered right on the canvas (primary-axis +
 * small set = show all, house-standard pill convention), and a one-tap entering-year
 * step so the roadmap renders THEIR semesters ("Fall 2026 · Freshman").
 * A faint ghost roadmap breathes behind everything: the empty state previews
 * the product.
 */

function GhostRoadmap() {
  // Static, faint, decorative — border-faint only, no saturated color.
  const cols = [0, 1, 2, 3, 4, 5];
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      aria-hidden="true"
    >
      {cols.map((c) =>
        [0, 1, 2, 3].map((r) => (
          <rect
            key={`${c}-${r}`}
            x={60 + c * 240}
            y={70 + r * 120}
            width={190}
            height={78}
            rx={8}
            fill="none"
            stroke="var(--border-faint)"
            strokeWidth={1.5}
          />
        ))
      )}
      {[0, 1, 2].map((c) => (
        <path
          key={c}
          d={`M ${60 + c * 240 + 190} ${70 + 39 + c * 120} C ${60 + (c + 1) * 240 - 25} ${70 + 39 + c * 120}, ${60 + (c + 1) * 240 - 25} ${70 + 39 + (c + 1) * 120}, ${60 + (c + 1) * 240} ${70 + 39 + (c + 1) * 120}`}
          fill="none"
          stroke="var(--border-faint)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

const YEAR_OPTIONS = [2023, 2024, 2025, 2026];

export function FirstRun() {
  const { programs, loading, error, refetch } = usePrograms();
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const { enteringYear, setEnteringYear } = useAuth();

  const [pendingProgram, setPendingProgram] = useState<Program | null>(null);

  const commit = (program: Program, year: number | null) => {
    if (year) void setEnteringYear(year);
    setSelectedProgramId(program.id);
  };

  const pickProgram = (program: Program) => {
    // Already know their year (returning user)? Straight to the roadmap.
    if (enteringYear) commit(program, null);
    else setPendingProgram(program);
  };

  return (
    <div className="absolute inset-0 overflow-auto">
      <GhostRoadmap />
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 px-8 py-12">
        {/* Thesis */}
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <h2 className="t-headline text-[1.375rem]">
            Start with the courses you love.
          </h2>
          <p className="t-body text-ink-2">
            Pick a program to see the whole path laid out — then make it yours.
            Every change saves automatically.
          </p>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive-tint px-5 py-4">
            <p className="t-body font-semibold text-destructive-text">
              We couldn&apos;t load the programs
            </p>
            <button
              onClick={refetch}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 t-label text-destructive-text transition-colors hover:bg-destructive/10"
            >
              <RotateCw className="h-3 w-3" />
              Try again
            </button>
          </div>
        ) : pendingProgram ? (
          /* Step 2 — entering year */
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="t-label">{pendingProgram.short_name ?? pendingProgram.name}</p>
              <p className="t-body text-ink-2">
                When did you start at Cornell? We&apos;ll label the semesters as
                <em> your</em> semesters.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {YEAR_OPTIONS.map((y) => (
                <button
                  key={y}
                  onClick={() => commit(pendingProgram, y)}
                  className="rounded-full border-[1.5px] border-line bg-surface px-4 py-2 t-body font-semibold transition-colors hover:border-drop hover:bg-drop-tint"
                >
                  <span className="num">Fall {y}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => commit(pendingProgram, null)}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                I&apos;ll add this later
              </button>
              <button
                onClick={() => setPendingProgram(null)}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          /* Step 1 — program pills (13 CoE majors since 2026-07) */
          <div className="grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-[76px] animate-pulse rounded-xl border border-line bg-surface-2/60"
                    aria-hidden="true"
                  />
                ))
              : programs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickProgram(p)}
                    className={cn(
                      "group flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-left",
                      "transition-all hover:-translate-y-0.5 hover:border-drop hover:bg-drop-tint/60",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    )}
                  >
                    <span className="t-label text-ink-4 transition-colors group-hover:text-drop-text">
                      {p.short_name ?? "Program"}
                    </span>
                    <span className="t-body font-semibold">{p.name}</span>
                    <span className="t-meta">
                      {p.college} · <span className="num">{p.catalog_year}</span> catalog
                    </span>
                  </button>
                ))}
          </div>
        )}

        <p className="t-meta max-w-sm text-center text-ink-4">
          Not sure which major fits? Pick any program to start — the Majors
          panel watches what you choose and shows where it leads.
        </p>
      </div>
    </div>
  );
}
