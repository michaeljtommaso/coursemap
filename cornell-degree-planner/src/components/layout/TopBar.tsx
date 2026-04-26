import { GraduationCap, LayoutGrid, Sun, Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProgramMap } from "@/hooks/useProgramMap";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useThemeStore } from "@/store/useThemeStore";

export function TopBar() {
  const program = useProgramMap();
  const setSelectedProgramId = useProgramStore((state) => state.setSelectedProgramId);
  const resetPlan = usePlannerStore((state) => state.resetPlan);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <div className="border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-foreground p-2 text-background">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Cornell Degree Planner</h1>
            {program && (
              <p className="text-sm text-muted-foreground">
                {program.college} &bull; {program.program} &bull; {program.catalogYear}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <LayoutGrid className="h-4 w-4" />
              Interactive roadmap demo
            </CardContent>
          </Card>
          {program && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.confirm("Reset your plan to the default demo state?")) {
                    resetPlan();
                  }
                }}
              >
                Reset plan
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedProgramId(null)}>
                Change program
              </Button>
            </>
          )}
          <Button variant="outline" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
