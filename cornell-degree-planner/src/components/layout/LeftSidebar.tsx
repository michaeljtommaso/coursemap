import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useMajorMatch } from "@/hooks/useMajorMatch";
import { slotCredits, classOfYear } from "@/lib/planner/semesters";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * LeftSidebar (spec 004 "intimate") — the journey rail. Progress is framed as
 * a journey ("62 of 120 credits — halfway there"), the timeline is THEIRS
 * (Class of 2030), and the Major Match teaser deep-links into the Majors tab.
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

const YEAR_OPTIONS = [2023, 2024, 2025, 2026];

export function LeftSidebar({ slots }: { slots: ProgramSlotWithData[] }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  // PINNED CONTRACT (spec 006 §B.1): inProgressSlotIds lands on the same plan
  // context completedSlotIds/waivedSlotIds already come from. It is read
  // here, never derived — "in progress" is a manual state, not engine output.
  const { completedSlotIds, waivedSlotIds, inProgressSlotIds, slotSelections, selectedCourses } =
    usePlan();
  const { enteringYear, setEnteringYear } = useAuth();
  const { programs } = usePrograms();
  const { matches, ready } = useMajorMatch(slots);

  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  const totalCredits = program?.total_credits ?? 120;

  const { earnedCredits, inProgressCredits, doneSlots } = useMemo(() => {
    let credits = 0;
    let inProgress = 0;
    let done = 0;
    const completedSet = new Set(completedSlotIds);
    const waivedSet = new Set(waivedSlotIds);
    const inProgressSet = new Set(inProgressSlotIds);
    for (const slot of slots) {
      if (waivedSet.has(slot.id)) done++;
      // In progress does NOT count as earned/done (spec 006 §B.1) — it's
      // tallied separately, same credit calc as earned, own bucket.
      if (inProgressSet.has(slot.id)) {
        const placedId = slotSelections[slot.id];
        const placed = placedId ? (selectedCourses[placedId] ?? null) : null;
        const cr = slotCredits(slot, placed);
        if (cr) inProgress += cr.min;
      }
      if (!completedSet.has(slot.id)) continue;
      done++;
      const placedId = slotSelections[slot.id];
      const placed = placedId ? (selectedCourses[placedId] ?? null) : null;
      const cr = slotCredits(slot, placed);
      if (cr) credits += cr.min;
    }
    return { earnedCredits: credits, inProgressCredits: inProgress, doneSlots: done };
  }, [slots, completedSlotIds, waivedSlotIds, inProgressSlotIds, slotSelections, selectedCourses]);

  const pct = totalCredits > 0 ? Math.min(100, Math.round((earnedCredits / totalCredits) * 100)) : 0;
  const gradYear = classOfYear(enteringYear);
  const topMatch = ready ? matches[0] : null;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-line bg-surface/60 px-4 py-5">
      {/* Journey */}
      <section>
        <p className="mb-2 t-label">Your journey</p>
        {selectedProgramId && slots.length > 0 ? (
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
              <span className="num">{doneSlots}</span> of{" "}
              <span className="num">{slots.length}</span> requirements settled
            </p>
          </>
        ) : (
          <p className="t-meta">Pick a program and this becomes your road home.</p>
        )}
      </section>

      {/* Timeline */}
      <section>
        <p className="mb-2 t-label">Your timeline</p>
        {enteringYear ? (
          <p className="t-body">
            <span className="num">{enteringYear}</span> –{" "}
            <span className="num">{gradYear}</span>
            <span className="mt-0.5 block t-meta">
              Class of <span className="num">{gradYear}</span>
            </span>
          </p>
        ) : (
          <>
            <p className="mb-1.5 t-meta">When did you start at Cornell?</p>
            <div className="flex flex-wrap gap-1">
              {YEAR_OPTIONS.map((y) => (
                <button
                  key={y}
                  onClick={() => void setEnteringYear(y)}
                  className="rounded-full border border-line bg-surface px-2 py-0.5 t-meta transition-colors hover:border-drop hover:bg-drop-tint"
                >
                  <span className="num">{y}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Legend */}
      <section>
        <p className="mb-2 t-label">Legend</p>
        <div className="flex flex-col gap-1.5">
          {/* One entry per state in the spec-006 model, mirroring SlotCard's
              rail/tint tokens: manual states first, then engine-derived. The
              amber `available` token now reads as Warning on cards; plain
              Available renders neutral (no rail), hence the muted dot. */}
          {[
            { label: "Completed", color: "bg-complete" },
            { label: "In progress", color: "bg-drop" },
            { label: "Waived", color: "bg-waived" },
            { label: "Available", color: "bg-ink-4" },
            { label: "Blocked — needs prereqs", color: "bg-destructive" },
            { label: "Warning — term or credits", color: "bg-available" },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
              <span className="t-body">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Major Match teaser → Majors tab */}
      <section>
        <p className="mb-2 t-label">Major Match</p>
        {topMatch && topMatch.matched > 0 ? (
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
            Your courses will point at a major — complete a few and look here.
          </button>
        )}
      </section>

      {program && (
        <p className="mt-auto t-meta text-ink-4">
          {program.college} · <span className="num">{program.catalog_year}</span> catalog
        </p>
      )}
    </aside>
  );
}
