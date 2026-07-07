import { BarChart3 } from "lucide-react";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import type { ProgramSlotWithData } from "@/types/db";

export function LeftSidebar({ slots }: { slots: ProgramSlotWithData[] }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const completedSlotIds = usePlannerStore((s) => s.completedSlotIds);

  const totalSlots = slots.length;
  const completedCount = completedSlotIds.filter((id) =>
    slots.some((s) => s.id === id)
  ).length;
  const pct = totalSlots > 0 ? Math.round((completedCount / totalSlots) * 100) : 0;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-border bg-card/60 px-4 py-5">
      {/* Progress */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Progress
        </p>
        {selectedProgramId && totalSlots > 0 ? (
          <>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium text-foreground">
                {completedCount} / {totalSlots} slots
              </span>
              <span className="text-[10px] text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Load a template to track progress.
          </p>
        )}
      </section>

      {/* Status legend */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Legend
        </p>
        <div className="flex flex-col gap-1.5">
          {[
            { label: "Completed", color: "bg-emerald-400" },
            { label: "Available", color: "bg-amber-400" },
            { label: "Waived", color: "bg-violet-400" },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
              <span className="text-[11px] text-foreground">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Major Match — placeholder */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Major Match
        </p>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-center text-muted-foreground">
          <BarChart3 className="h-7 w-7 opacity-40" />
          <p className="text-[10px] leading-snug">
            Complete some slots to see how well your courses match each major.
          </p>
        </div>
      </section>
      {/* Program info footer removed until Firebase lands — was hardcoded
          "Cornell Engineering · 2026 Catalog" (spec 001 §4). Derive from the
          selected program's college/catalog_year when the data layer is live. */}
    </aside>
  );
}
