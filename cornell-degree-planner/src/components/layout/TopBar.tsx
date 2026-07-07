import { useEffect, useRef, useState } from "react";
import { ChevronDown, GraduationCap, Moon, Sun, RotateCw, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { useThemeStore } from "@/store/useThemeStore";

export function TopBar() {
  const { programs, loading, error, refetch } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const customTemplates = useProgramStore((s) => s.customTemplates);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const addCustomTemplate = useProgramStore((s) => s.addCustomTemplate);
  const resetPlan = usePlan().resetPlan;
  const { isAnonymous, linkGoogle } = useAuth();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  // Quiet Google link-upgrade affordance (spec 002 §7). A real Google popup can't
  // complete headless — verification (c) lists it as a manual test.
  const [linking, setLinking] = useState(false);
  const handleSavePlan = async () => {
    if (linking) return;
    setLinking(true);
    try {
      await linkGoogle();
    } catch (err) {
      // Popup closed/blocked or provider not enabled — stay quiet, log only.
      console.warn("[topbar] Google link failed", err);
    } finally {
      setLinking(false);
    }
  };

  // Two-step inline Reset confirm — replaces window.confirm (spec 003 §5.4).
  // Auto-reverts to the resting state after 3s if not confirmed.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    };
  }, []);

  const armReset = () => {
    setConfirmingReset(true);
    if (revertTimer.current) clearTimeout(revertTimer.current);
    revertTimer.current = setTimeout(() => setConfirmingReset(false), 3000);
  };

  const cancelReset = () => {
    setConfirmingReset(false);
    if (revertTimer.current) clearTimeout(revertTimer.current);
  };

  const confirmReset = () => {
    resetPlan();
    cancelReset();
  };

  const handleProgramChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null;

    if (id === "__add__") {
      const newId = addCustomTemplate();
      setSelectedProgramId(newId);
      return;
    }

    // No resetPlan() on switch anymore — each program has its OWN cloud plan doc,
    // and PlanProvider resolves (or auto-creates) it when selectedProgramId
    // changes. Reset is now an explicit user action (the Reset button) that
    // clears the CURRENT program's plan only (spec 002 §6).
    if (id !== selectedProgramId) {
      setSelectedProgramId(id);
    }
  };

  return (
    <div className="border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 pb-3 pt-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-ink p-2 text-canvas">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h1 className="t-headline">Cornell Degree Planner</h1>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Load Template selector */}
          <div className="relative">
            <label className="pointer-events-none absolute -top-4 left-0 t-label">
              Load Template
            </label>
            <select
              value={selectedProgramId ?? ""}
              onChange={handleProgramChange}
              disabled={loading}
              className="cursor-pointer appearance-none rounded-lg border border-line bg-surface py-1.5 pl-3 pr-8 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:opacity-50"
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
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
          </div>

          {/* Program-load error honesty — distinct from an empty dropdown (spec §5.2) */}
          {error && (
            <button
              onClick={refetch}
              title="Couldn't reach the course catalog"
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive-tint px-2.5 py-1.5 t-label text-destructive-text transition-colors hover:bg-destructive/10"
            >
              <RotateCw className="h-3 w-3" />
              Couldn&apos;t load — Retry
            </button>
          )}

          {selectedProgramId &&
            (confirmingReset ? (
              <div className="flex items-center gap-1.5">
                <Button variant="destructive" size="sm" onClick={confirmReset}>
                  Confirm reset?
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelReset}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={armReset}>
                Reset
              </Button>
            ))}

          {/* Quiet "Save your plan" — anon → Google upgrade (spec 002 §7). Only
              shown while anonymous; once linked, the same uid keeps all plans. */}
          {isAnonymous && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSavePlan}
              disabled={linking}
              title="Sign in with Google to save your plan across devices"
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              {linking ? "Saving…" : "Save your plan"}
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
