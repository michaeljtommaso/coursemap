import { useEffect, useRef, useState } from "react";
import { ChevronDown, GraduationCap, Moon, Sun, RotateCw, Cloud, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { useThemeStore } from "@/store/useThemeStore";

/**
 * TopBar (spec 004) — the plan's identity lives here now: an inline-editable
 * plan name beside the brand ("Michael's CS Plan"), the program switcher,
 * quiet auth affordance, theme toggle. Custom templates are deferred
 * (spec 000 §2) — the UI entry point is removed; store data is preserved.
 */

function PlanName() {
  const { planName, renamePlan, planId } = usePlan();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!planId || !planName) return null;

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== planName) renamePlan(draft);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 border-l border-line pl-3">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          className="w-44 rounded-md border border-line bg-surface px-2 py-0.5 t-body font-semibold outline-none focus:border-ink focus:ring-1 focus:ring-ink"
          aria-label="Plan name"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(planName);
            setEditing(true);
          }}
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-2"
          title="Rename your plan"
        >
          <span className="truncate t-body font-semibold">{planName}</span>
          <Pencil className="h-3 w-3 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

export function TopBar() {
  const { programs, loading, error, refetch } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const { resetPlan } = usePlan();
  const { isAnonymous, linkGoogle, firstName } = useAuth();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const [linking, setLinking] = useState(false);
  const handleSavePlan = async () => {
    if (linking) return;
    setLinking(true);
    try {
      await linkGoogle();
    } catch (err) {
      console.warn("[topbar] Google link failed", err);
    } finally {
      setLinking(false);
    }
  };

  // Two-step inline Reset confirm (spec 003 §5.4); auto-reverts after 3s.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (revertTimer.current) clearTimeout(revertTimer.current);
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
    // Each program has its own cloud plan; switching never wipes anything.
    if (id !== selectedProgramId) setSelectedProgramId(id);
  };

  return (
    <div className="border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex items-center justify-between gap-4 px-4 pb-3 pt-6">
        {/* Brand + plan identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-2xl bg-ink p-2 text-canvas">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h1 className="shrink-0 t-headline">Cornell Degree Planner</h1>
          <PlanName />
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-2">
          {selectedProgramId && (
            <div className="relative">
              <label className="pointer-events-none absolute -top-4 left-0 t-label">
                Program
              </label>
              <select
                value={selectedProgramId ?? ""}
                onChange={handleProgramChange}
                disabled={loading}
                className="cursor-pointer appearance-none rounded-lg border border-line bg-surface py-1.5 pl-3 pr-8 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:opacity-50"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
            </div>
          )}

          {error && (
            <button
              onClick={refetch}
              title="We couldn't reach the catalog — your plan is safe."
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
                  Clear everything?
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelReset}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={armReset}>
                Reset
              </Button>
            ))}

          {isAnonymous ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSavePlan}
              disabled={linking}
              title="Sign in with Google (your Cornell account works) so your plan follows you to any device"
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              {linking ? "Saving…" : "Save your plan"}
            </Button>
          ) : (
            firstName && (
              <span className="t-meta text-ink-3" title="Signed in — your plan follows you">
                Hi, {firstName}
              </span>
            )
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
