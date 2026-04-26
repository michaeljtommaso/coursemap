import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useProgramMap } from "@/hooks/useProgramMap";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildCategoryProgress } from "@/lib/planner/progressUtils";
import { usePlannerWarnings } from "@/hooks/usePlannerWarnings";

export function ProgressPanel() {
  const program = useProgramMap();
  const completed = usePlannerStore((state) => state.completed);
  const planned = usePlannerStore((state) => state.planned);
  const plannedSlots = usePlannerStore((state) => state.plannedSlots);
  const waived = usePlannerStore((state) => state.waived);
  const warnings = usePlannerWarnings();

  const categories = useMemo(() => {
    if (!program) return [];
    return buildCategoryProgress(program, { completed, planned, plannedSlots, waived });
  }, [program, completed, planned, plannedSlots, waived]);

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {categories.map((item) => {
          const percent = item.total === 0 ? 0 : (item.completed / item.total) * 100;
          return (
            <div key={item.category} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">{item.category}</span>
                <span className="text-slate-500">{item.completed}/{item.total}</span>
              </div>
              <Progress value={percent} />
            </div>
          );
        })}

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-900">Warnings</h4>
          {warnings.length === 0 ? (
            <p className="text-sm text-slate-500">No planning warnings right now.</p>
          ) : (
            warnings.map((warning) => (
              <div
                key={warning.id}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              >
                {warning.message}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
