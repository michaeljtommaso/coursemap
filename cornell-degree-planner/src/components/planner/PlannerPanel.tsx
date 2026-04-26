import { useMemo } from "react";
import { plannerTerms, SLOTS_PER_TERM } from "@/data/terms";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramMap } from "@/hooks/useProgramMap";
import { evaluateNodeStatus } from "@/lib/graph/evaluateNodeStatus";
import { PlannerSlot } from "@/components/planner/PlannerSlot";
import { cn } from "@/lib/utils";

export function PlannerPanel() {
  const program = useProgramMap();
  const completed = usePlannerStore((s) => s.completed);
  const planned = usePlannerStore((s) => s.planned);
  const plannedSlots = usePlannerStore((s) => s.plannedSlots);
  const waived = usePlannerStore((s) => s.waived);
  const unplanCourse = usePlannerStore((s) => s.unplanCourse);

  const plan = useMemo(() => ({ completed, planned, plannedSlots, waived }), [completed, planned, plannedSlots, waived]);

  return (
    <div className="rounded-3xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">Semester Planner</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Drag courses from the roadmap into a semester slot</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[1120px] gap-0">
          {plannerTerms.map((term, termIdx) => {
            const isSpring = term.season === "spring";

            return (
              <div
                key={term.id}
                className={cn(
                  "flex flex-1 flex-col border-r border-border last:border-r-0",
                  isSpring ? "bg-muted/20" : ""
                )}
              >
                {/* Column header */}
                <div className={cn(
                  "flex flex-col items-center gap-0.5 border-b border-border px-2 py-2.5",
                  isSpring ? "bg-muted/30" : ""
                )}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Sem {termIdx + 1}
                  </span>
                  <span className="text-xs font-semibold text-foreground">{term.label}</span>
                </div>

                {/* Slots */}
                <div className="flex flex-col gap-1.5 p-2">
                  {Array.from({ length: SLOTS_PER_TERM }, (_, slotIdx) => {
                    const nodeId = plannedSlots[`${term.id}:${slotIdx}`] ?? null;
                    const course = nodeId && program
                      ? (program.nodes.find((n) => n.id === nodeId) ?? null)
                      : null;
                    const status = course
                      ? evaluateNodeStatus(course, plan)
                      : null;

                    return (
                      <PlannerSlot
                        key={slotIdx}
                        termId={term.id}
                        slot={slotIdx}
                        course={course}
                        status={status}
                        onRemove={unplanCourse}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
