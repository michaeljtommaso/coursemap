import { useMemo } from "react";
import { ArrowRight, Map as MapIcon, LibraryBig } from "lucide-react";
import { NavLink } from "react-router-dom";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useMajorMatch } from "@/hooks/useMajorMatch";
import { creditProfileCredits } from "@/lib/planner/creditPool";
import { cn } from "@/lib/utils";
import { StillNeededPanel } from "@/components/requirements/StillNeededPanel";
import type { BoardCard } from "@/lib/planner/board";

/**
 * LeftSidebar (spec 004 "intimate") — the journey rail. Progress is framed as
 * a journey ("62 of 120 credits — halfway there"), the timeline is THEIRS
 * (Class of 2030), and the Major Match teaser deep-links into the Majors tab.
 * Spec 014 D2: the "Still needed" checklist owns the rail's middle; the legend
 * moved to the top bar's help popover; My credits and Sign in / the account
 * menu moved to the top bar too (2026-10-09).
 */

function journeyPhrase(pct: number): string {
  if (pct <= 0) return "The first step is marking a course done.";
  if (pct < 25) return "Just getting started.";
  if (pct < 50) return "Building momentum.";
  if (pct < 60) return "Halfway there.";
  if (pct < 85) return "Past the halfway mark — keep going.";
  if (pct < 100) return "The home stretch.";
  return "Every requirement, done.";
}

export function LeftSidebar({ cards }: { cards: BoardCard[] }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  // Manual states are read from the plan (spec 006 §B.1), never derived —
  // "in progress" is a manual state, not engine output. Spec 014: they key on
  // placements. Requirement progress lives in the Still-needed panel.
  const { completedIds, inProgressIds, placements, placedCourses } = usePlan();
  const { creditProfile } = useAuth();
  const { programs } = usePrograms();
  const { matches, ready } = useMajorMatch(cards);

  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  const totalCredits = program?.total_credits ?? 120;

  const { earnedCredits, inProgressCredits, doneCount } = useMemo(() => {
    let credits = 0;
    let inProgress = 0;
    let done = 0;
    const completedSet = new Set(completedIds);
    const inProgressSet = new Set(inProgressIds);
    const completedCourseIds = new Set<string>();
    for (const p of placements) {
      const cr = placedCourses[p.courseId]?.credits_min ?? 0;
      // In progress does NOT count as earned/done (spec 006 §B.1) — it's
      // tallied separately, same credit calc as earned, own bucket.
      if (inProgressSet.has(p.id)) inProgress += cr;
      if (!completedSet.has(p.id)) continue;
      done++;
      credits += cr;
      completedCourseIds.add(p.courseId);
    }
    // AP/IB/transfer credit counts toward earned credits (spec 007 §2c), once,
    // and never on top of the same course already completed on the board.
    credits += creditProfileCredits(creditProfile, completedCourseIds);
    return { earnedCredits: credits, inProgressCredits: inProgress, doneCount: done };
  }, [placements, placedCourses, completedIds, inProgressIds, creditProfile]);

  const pct = totalCredits > 0 ? Math.min(100, Math.round((earnedCredits / totalCredits) * 100)) : 0;
  const topMatch = ready ? matches[0] : null;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-line bg-surface/60 px-4 py-5">
      {/* Nav (spec 006 §E1) — Planner ↔ Classes directory */}
      <nav className="flex flex-col gap-0.5">
        {[
          { to: "/", label: "Planner", Icon: MapIcon, end: true },
          { to: "/classes", label: "Classes", Icon: LibraryBig, end: false },
        ].map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 t-body font-medium transition-colors",
                isActive
                  ? "bg-surface-2 text-ink"
                  : "text-ink-3 hover:bg-surface-2/60 hover:text-ink"
              )
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Journey */}
      <section>
        <p className="mb-2 t-label">Your journey</p>
        {selectedProgramId ? (
          <>
            <p className="t-body font-semibold">
              <span className="num">{earnedCredits}</span> of{" "}
              <span className="num">{totalCredits}</span> credits
            </p>
            {inProgressCredits > 0 && (
              <p className="mt-0.5 t-meta text-ink-3">
                <span className="num">{earnedCredits}</span> earned ·{" "}
                <span className="num">{inProgressCredits}</span> in progress
              </p>
            )}
            <div className="mb-1.5 mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-complete transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="t-meta">{journeyPhrase(pct)}</p>
            <p className="mt-1.5 t-meta text-ink-4">
              <span className="num">{doneCount}</span> of{" "}
              <span className="num">{placements.length}</span> courses completed
            </p>
          </>
        ) : (
          <p className="t-meta">Pick a program and this becomes your road home.</p>
        )}
      </section>


      {/* Still needed (spec 014 D2) — replaces the legend (now the top bar's
          help popover) and the slot-based requirement progress. Takes the
          rail's free height and scrolls inside it. */}
      <StillNeededPanel />

      {/* Major Match teaser → Majors tab */}
      <section>
        <p className="mb-2 t-label">Major Match</p>
        {topMatch && topMatch.creditsSatisfied > 0 ? (
          <button
            onClick={() => openPanel("majors")}
            className="group flex w-full flex-col gap-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-drop"
          >
            <span className="flex items-baseline justify-between">
              <span className="t-body font-semibold">
                {topMatch.program.short_name ?? topMatch.program.name}
              </span>
              <span className="num t-body font-semibold">{topMatch.pct}%</span>
            </span>
            <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-complete transition-all duration-500"
                style={{ width: `${topMatch.pct}%` }}
              />
            </span>
            <span className="flex items-center gap-1 t-meta text-ink-3 transition-colors group-hover:text-ink">
              See every major <ArrowRight className="h-2.5 w-2.5" />
            </span>
          </button>
        ) : (
          <button
            onClick={() => openPanel("majors")}
            className="w-full rounded-lg border border-dashed border-line px-2.5 py-2 text-left t-meta text-ink-3 transition-colors hover:border-drop hover:text-ink"
          >
            Add courses to your board and they'll point at a major.
          </button>
        )}
      </section>

      {/* Footer: catalog line + account (standard shell placement, spec 006 §C3). */}
      <div className="mt-auto flex flex-col gap-2">
        {program && (
          <p className="t-meta text-ink-4">
            {program.college} · <span className="num">{program.catalog_year}</span> catalog
          </p>
        )}
      </div>
    </aside>
  );
}
