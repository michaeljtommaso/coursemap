import { useProgramMap } from "@/hooks/useProgramMap";
import { ProgressPanel } from "@/components/progress/ProgressPanel";
import { NodeDetailDrawer } from "@/components/details/NodeDetailDrawer";

const legendItems = [
  { label: "Completed", color: "bg-emerald-400" },
  { label: "Planned", color: "bg-blue-400" },
  { label: "Available", color: "bg-amber-400" },
  { label: "Locked", color: "bg-slate-300 dark:bg-slate-600" },
  { label: "Waived", color: "bg-violet-400" },
];

export function LeftSidebar() {
  const program = useProgramMap();
  if (!program) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Program info */}
      <div className="rounded-2xl bg-card border border-border px-4 py-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Program</p>
        <div className="space-y-1.5 text-xs">
          {[
            ["Institution", program.institution],
            ["College", program.college],
            ["Degree", program.program],
            ["Catalog", program.catalogYear],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <span className="font-medium text-muted-foreground">{label}</span>
              <span className="text-foreground leading-tight">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-2xl bg-card border border-border px-4 py-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Legend</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.color}`} />
              <span className="text-xs text-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress */}
      <ProgressPanel />

      {/* Node details */}
      <NodeDetailDrawer />
    </div>
  );
}
