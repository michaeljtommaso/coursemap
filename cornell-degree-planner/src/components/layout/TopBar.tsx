import { ChevronDown, GraduationCap, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useThemeStore } from "@/store/useThemeStore";

export function TopBar() {
  const { programs, loading } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const customTemplates = useProgramStore((s) => s.customTemplates);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const addCustomTemplate = useProgramStore((s) => s.addCustomTemplate);
  const resetPlan = usePlannerStore((s) => s.resetPlan);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const handleProgramChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null;

    if (id === "__add__") {
      const newId = addCustomTemplate();
      setSelectedProgramId(newId);
      resetPlan();
      return;
    }

    if (id !== selectedProgramId) {
      setSelectedProgramId(id);
      resetPlan();
    }
  };

  return (
    <div className="border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 pb-3 pt-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-foreground p-2 text-background">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Cornell Degree Planner</h1>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Load Template selector */}
          <div className="relative">
            <label className="pointer-events-none absolute -top-4 left-0 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              Load Template
            </label>
            <select
              value={selectedProgramId ?? ""}
              onChange={handleProgramChange}
              disabled={loading}
              className="appearance-none rounded-lg border border-border bg-card py-1.5 pl-3 pr-8 text-xs font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring cursor-pointer disabled:opacity-50"
            >
              <option value="">{loading ? "Loading…" : "— Choose a program —"}</option>

              {programs.length > 0 && (
                <optgroup label="Programs">
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}

              <optgroup label="Custom">
                {customTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="__add__">＋ New Template</option>
              </optgroup>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>

          {selectedProgramId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm("Reset your plan? This clears all completions and slot selections.")) {
                  resetPlan();
                }
              }}
            >
              Reset
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
