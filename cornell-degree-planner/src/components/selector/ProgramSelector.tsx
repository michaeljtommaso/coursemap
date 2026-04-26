import { useState } from "react";
import { GraduationCap, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { programOptions } from "@/data/programs/index";
import { cn } from "@/lib/utils";

export function ProgramSelector() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const setSelectedProgramId = useProgramStore((state) => state.setSelectedProgramId);
  const resetPlan = usePlannerStore((state) => state.resetPlan);

  function handleConfirm() {
    if (!selectedId) return;
    resetPlan();
    setSelectedProgramId(selectedId);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-900 text-white">
            <GraduationCap className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Cornell Degree Planner</h1>
          <p className="mt-2 text-slate-500">
            Visualize your degree requirements, track progress, and plan your semesters with an interactive roadmap.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">Choose a program to get started</p>
          {programOptions.map((option) => (
            <button
              key={option.id}
              className="w-full text-left"
              onClick={() => setSelectedId(option.id)}
              onMouseEnter={() => setHoveredId(option.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <Card
                className={cn(
                  "cursor-pointer border transition-all",
                  selectedId === option.id
                    ? "border-slate-900 shadow-md"
                    : hoveredId === option.id
                      ? "border-slate-400"
                      : "border-slate-200"
                )}
              >
                <CardHeader className="pb-1 pt-4">
                  <CardTitle className="text-base">{option.program}</CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <p className="text-sm text-slate-500">
                    {option.institution} &bull; {option.college} &bull; {option.catalogYear}
                  </p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        <Button
          className="w-full"
          disabled={!selectedId}
          onClick={handleConfirm}
        >
          View Roadmap
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
