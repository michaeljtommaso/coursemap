import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, GraduationCap, Moon, Sun, RotateCw, Cloud, Pencil,
  Share2, Check, Trash2, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useThemeStore } from "@/store/useThemeStore";
import { createShare } from "@/services/shares";

/**
 * TopBar (spec 004) — the plan's identity lives here now: an inline-editable
 * plan name beside the brand ("Michael's CS Plan"), the program switcher,
 * quiet auth affordance, theme toggle. Custom templates are deferred
 * (spec 000 §2) — the UI entry point is removed; store data is preserved.
 */

/** Plan identity + switcher (spec 005 §6): rename inline, switch between plans
 *  (multiple per program), create a what-if, two-step delete. */
function PlanMenu() {
  const { planName, renamePlan, planId, plansList, switchPlan, createNewPlan, deletePlan } =
    usePlan();
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  useEffect(() => {
    if (!open) setConfirmDeleteId(null);
  }, [open]);

  if (!planId || !planName) return null;

  const shortNameOf = (programId: string) =>
    programs.find((p) => p.id === programId)?.short_name ?? programId;

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== planName) renamePlan(draft);
  };

  const handleNewPlan = async () => {
    if (!selectedProgramId || busy) return;
    setBusy(true);
    try {
      const count = plansList.filter((p) => p.programId === selectedProgramId).length;
      await createNewPlan(selectedProgramId, `${shortNameOf(selectedProgramId)} · draft ${count + 1}`);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-w-0 items-center gap-0.5 border-l border-line pl-3">
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
        <>
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
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Switch plans"
            aria-expanded={open}
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
        </>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-xl">
            <p className="px-1.5 pb-1 t-label">Your plans</p>
            {plansList.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-1.5 py-1",
                  p.id === planId ? "bg-surface-2" : "hover:bg-surface-2/60"
                )}
              >
                <button
                  onClick={async () => {
                    if (p.id !== planId) await switchPlan(p.id, p.programId);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                >
                  <span className="truncate t-body font-medium">{p.name}</span>
                  <span className="shrink-0 t-meta text-ink-4">{shortNameOf(p.programId)}</span>
                </button>
                {confirmDeleteId === p.id ? (
                  <button
                    onClick={async () => {
                      setConfirmDeleteId(null);
                      await deletePlan(p.id);
                    }}
                    className="shrink-0 rounded px-1.5 py-0.5 t-label text-destructive-text transition-colors hover:bg-destructive-tint"
                  >
                    Sure?
                  </button>
                ) : (
                  plansList.length > 1 && (
                    <button
                      onClick={() => setConfirmDeleteId(p.id)}
                      className="shrink-0 rounded p-1 text-ink-4 transition-colors hover:bg-destructive-tint hover:text-destructive-text"
                      aria-label={`Delete plan ${p.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )
                )}
              </div>
            ))}
            <button
              onClick={handleNewPlan}
              disabled={busy || !selectedProgramId}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-line/60 px-1.5 pb-0.5 pt-1.5 t-meta text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              {busy ? "Creating…" : "New plan for this program (what-if)"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Share (spec 005 §5): freeze the current plan into an immutable public
 *  snapshot and copy the link. Re-sharing mints a new link. */
function ShareButton() {
  const {
    planId, planName, slotSelections, completedSlotIds, waivedSlotIds,
    selectedCourses, slotOverrides, customSlots,
  } = usePlan();
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { uid, enteringYear } = useAuth();
  const [status, setStatus] = useState<
    "idle" | "working" | "copied" | "cooldown" | "failed"
  >("idle");
  const lastShareRef = useRef(0);

  if (!planId || !selectedProgramId) return null;
  const program = programs.find((p) => p.id === selectedProgramId);

  const handleShare = async () => {
    if (status === "working" || !uid || !program) return;
    // Client-side mirror of the rules cooldown (30s) — UX only; the rules
    // enforce it authoritatively via the lastShareAt batch stamp.
    if (Date.now() - lastShareRef.current < 30_000) {
      setStatus("cooldown");
      setTimeout(() => setStatus("idle"), 2500);
      return;
    }
    setStatus("working");
    try {
      const courseSnapshots: Record<string, unknown> = {};
      for (const [id, c] of Object.entries(selectedCourses)) {
        courseSnapshots[id] = {
          id: c.id, subject: c.subject, number: c.number, title: c.title,
          creditsMin: c.credits_min, creditsMax: c.credits_max,
        };
      }
      const shareId = await createShare({
        createdBy: uid,
        planName: planName ?? "Shared plan",
        programId: program.id,
        programName: program.name,
        enteringYear: enteringYear ?? null,
        slotSelections,
        completedSlotIds,
        waivedSlotIds,
        courseSnapshots,
        slotOverrides,
        customSlots,
        schemaVersion: 2,
      });
      const url = `${window.location.origin}/s/${shareId}`;
      await navigator.clipboard.writeText(url);
      lastShareRef.current = Date.now();
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      // permission-denied inside the cooldown window = the rules limiter.
      const denied = (err as { code?: string })?.code === "permission-denied";
      console.warn("[share] create failed", err);
      setStatus(denied ? "cooldown" : "failed");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={status === "working"}
      title="Copy a read-only link — a frozen snapshot of your plan as it is right now"
    >
      {status === "copied" ? (
        <>
          <Check className="mr-1.5 h-3.5 w-3.5 text-complete-text" /> Link copied
        </>
      ) : status === "cooldown" ? (
        "One share per 30s — a moment"
      ) : status === "failed" ? (
        "Couldn't share"
      ) : (
        <>
          <Share2 className="mr-1.5 h-3.5 w-3.5" />
          {status === "working" ? "Sharing…" : "Share"}
        </>
      )}
    </Button>
  );
}

export function TopBar() {
  const { programs, loading, error, refetch } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const { resetPlan } = usePlan();
  const { isAnonymous, firstName } = useAuth();
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

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
          <PlanMenu />
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

          <ShareButton />

          {selectedProgramId &&
            (confirmingReset ? (
              <div className="flex items-center gap-1.5">
                {/* Tint-style destructive confirm — same triad as the
                    delete-plan "Sure?" confirm and catalog-retry button, so
                    two-step confirms read consistently across this bar. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={confirmReset}
                  className="border-destructive-text/30 bg-destructive-tint text-destructive-text hover:bg-destructive-text hover:text-destructive-tint"
                >
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
              onClick={() => setSignInOpen(true)}
              title="Sign in with Google to save your plan"
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              Save your plan
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
