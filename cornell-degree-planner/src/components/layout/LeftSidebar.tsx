import { useMemo } from "react";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useMajorMatch } from "@/hooks/useMajorMatch";
import { creditProfileCredits } from "@/lib/planner/creditPool";
import { withChosenCredits } from "@/lib/planner/chosenCredits";
import { buildBoard, type BoardCard } from "@/lib/planner/board";
import { RailResizeHandle } from "@/components/layout/RailResizeHandle";
import { RailNav } from "@/components/rail/RailNav";
import { RailJourney } from "@/components/rail/RailJourney";
import { RailStillNeeded } from "@/components/rail/RailStillNeeded";
import { MajorMatchLink } from "@/components/rail/MajorMatchLink";

/**
 * LeftSidebar — the planner rail, short and readable while classes move
 * around (spec 028 D9): navigation (Planner, Classes, Requirements); the
 * journey as one line plus its bar; Still needed as one line per requirement
 * group with "All requirements →" and, under it, the tried-classes reminder
 * (D13); Major Match as one link; the catalog line. Every requirement detail
 * lives on the Requirements page.
 */
export function LeftSidebar({ cards }: { cards: BoardCard[] }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  const railWidth = usePlannerStore((s) => s.leftRailWidth);
  // Manual states are read from the plan (spec 006 §B.1), never derived —
  // "in progress" is a manual state, not engine output. Spec 014: they key on
  // placements.
  const { completedIds, inProgressIds, placements, placedCourses, courseMarks } = usePlan();
  // Spec 028 D3: credit resolved for the student's college.
  const { resolved: creditProfile } = useCreditProfile();
  const { programs } = usePrograms();
  // The link never loads programs itself (spec 019 D11: Major Match loads
  // when the Majors tab opens); it shows the top match once that has run.
  const { matches, ready } = useMajorMatch(cards, { enabled: false });

  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  const totalCredits = program?.total_credits ?? 120;

  const { earnedCredits, inProgressCredits } = useMemo(() => {
    let credits = 0;
    let inProgress = 0;
    const completedSet = new Set(completedIds);
    const inProgressSet = new Set(inProgressIds);
    const completedCourseIds = new Set<string>();
    for (const p of placements) {
      const course = placedCourses[p.courseId];
      const cr = course ? withChosenCredits(course, courseMarks, p.courseId).credits_min : 0;
      // In progress does NOT count as earned (spec 006 §B.1) — tallied
      // separately, same credit calc as earned, own bucket.
      if (inProgressSet.has(p.id)) inProgress += cr;
      if (!completedSet.has(p.id)) continue;
      credits += cr;
      completedCourseIds.add(p.courseId);
    }
    // Exam/transfer credit counts toward earned credits (spec 007 §2c), once,
    // and never on top of the same course already completed on the board.
    credits += creditProfileCredits(creditProfile, completedCourseIds);
    return { earnedCredits: credits, inProgressCredits: inProgress };
  }, [placements, placedCourses, completedIds, inProgressIds, creditProfile, courseMarks]);

  // The board's rendered columns, for the reminder's suggested column (the
  // same builder the board and "Place on board" use). Semesters only: the
  // suggestion names an enrollment term, never a short term (spec 042).
  const columnSems = useMemo(
    () =>
      buildBoard(cards.map((c) => c.placement), {})
        .columns.filter((c) => !c.shortTerm)
        .map((c) => c.sem),
    [cards]
  );

  const top = ready ? matches[0] : null;

  return (
    <aside
      style={{ width: railWidth }}
      className="relative flex shrink-0 flex-col gap-4 border-r border-line bg-surface/60 px-4 py-5"
    >
      <RailResizeHandle />
      <RailNav />

      <RailJourney
        hasProgram={!!selectedProgramId}
        earned={earnedCredits}
        inProgress={inProgressCredits}
        total={totalCredits}
      />

      <RailStillNeeded columnSems={columnSems} />

      <MajorMatchLink
        top={
          top && top.creditsSatisfied > 0
            ? { name: top.program.short_name ?? top.program.name, pct: top.pct }
            : null
        }
        ready={ready}
        boardEmpty={placements.length === 0}
        onOpen={() => openPanel("majors")}
      />

      {/* Footer: catalog line (standard shell placement, spec 006 §C3). */}
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
