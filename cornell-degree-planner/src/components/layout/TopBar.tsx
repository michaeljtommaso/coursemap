import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/LogoMark";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { COLLEGES, programCollegeId, programIsVisible } from "@/lib/planner/colleges";
import { TopBarMenu, TopBarShortcuts } from "@/components/layout/TopBarMenu";
import { CatalogRetryButton } from "@/components/layout/CatalogRetryButton";

/**
 * TopBar (spec 004) — the plan's identity lives here now: an inline-editable
 * plan name beside the brand ("Michael's CS Plan") and the program switcher.
 * Everything else (major links, Share, My credits, Reset, sign-in, the status
 * legend, the tour, the theme) lives behind TopBarMenu (spec 033), so the bar
 * fits any laptop and never covers the brand. Custom templates are deferred
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
    <div data-tour="plans" className="relative flex min-w-0 items-center gap-0.5 border-l border-line pl-3">
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
          {/* z from the shared token scale (spec 006 §F4) rather than literal
              z-40/z-50. These sit inside TopBar's isolated stacking context, so
              only their RELATIVE order matters: backdrop below the panel. */}
          <div
            className="fixed inset-0 z-[var(--z-sidebar-backdrop)]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-[var(--z-sidebar-panel)] mt-1.5 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-xl">
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
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-line px-1.5 pb-0.5 pt-1.5 t-meta text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
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

/** Room the plan name keeps beside the logo before the inline shortcuts give
 *  way to the menu (px). */
const PLAN_NAME_ROOM = 180;

/**
 * Whether the inline shortcuts fit (spec 033). Measured, not a breakpoint: the
 * bar shows them while the brand group (logo + plan name) still gets its room,
 * and folds them into the menu the moment it wouldn't. It comes back out once
 * the bar is as wide as it needed to be. Anything that changes the controls'
 * width (major, sign-in) re-measures from the inline state.
 */
function useShortcutsFit(resetKey: string) {
  const barRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  const needed = useRef(0);
  const checkRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const bar = barRef.current;
    const brand = brandRef.current;
    if (!bar || !brand || typeof ResizeObserver === "undefined") return;
    // A new major or sign-in state changes the controls' width: start over
    // from the inline state and let the first check decide.
    needed.current = 0;
    let fresh = true;
    const check = () => {
      const logo = brand.querySelector("h1")?.getBoundingClientRect().width ?? 0;
      const want = logo + 12 + PLAN_NAME_ROOM;
      const have = brand.getBoundingClientRect().width;
      setFits((was) => {
        const shown = fresh ? true : was;
        fresh = false;
        if (shown && have < want) {
          needed.current = bar.clientWidth + (want - have);
          return false;
        }
        if (!shown && bar.clientWidth >= needed.current) return true;
        return shown;
      });
    };
    checkRef.current = check;
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    ro.observe(brand);
    check();
    return () => ro.disconnect();
  }, [resetKey]);

  // Showing or hiding the shortcuts changes the brand's width: measure again
  // straight after that commit instead of waiting on the observer.
  useLayoutEffect(() => checkRef.current(), [fits]);

  return { barRef, brandRef, fits };
}

export function TopBar() {
  const { programs, loading, error } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const { setStudentContext, isAnonymous } = useAuth();
  const { barRef, brandRef, fits } = useShortcutsFit(`${selectedProgramId}|${isAnonymous}`);

  const handleProgramChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null;
    // Each program has its own cloud plan; switching never wipes anything.
    if (id === selectedProgramId) return;
    setSelectedProgramId(id);
    // The picked major's college is the student's (spec 019 D11).
    const college = programCollegeId(programs.find((p) => p.id === id));
    if (college) void setStudentContext({ college });
  };

  // Hidden majors leave the picker (spec 019 D11) — except the one this plan
  // is on, so a student already on it still sees it. Grouped by college when
  // the list spans more than one.
  const pickable = programs.filter((p) => programIsVisible(p) || p.id === selectedProgramId);
  const ungrouped = pickable.filter((p) => programCollegeId(p) === null);
  const groups = COLLEGES.map((c) => ({
    college: c,
    programs: pickable.filter((p) => programCollegeId(p) === c.id),
  })).filter((g) => g.programs.length > 0);
  const option = (p: (typeof programs)[number]) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  );

  return (
    <div className="border-b border-line bg-surface/90 backdrop-blur">
      {/* Symmetric vertical padding, centered to --topbar-h (spec 006 §F4) —
          was pb-3/pt-6, which sat the row off-center. */}
      <div
        ref={barRef}
        className="mx-auto flex items-center justify-between gap-4 px-4 py-3"
        style={{ minHeight: "var(--topbar-h)" }}
      >
        {/* Brand + plan identity (Coursemap mark + wordmark; h1 semantics kept) */}
        <div ref={brandRef} className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="shrink-0">
            <LogoMark size={22} wordmark />
          </h1>
          <PlanMenu />
        </div>

        {/* Controls: the major picker, the inline shortcuts while they fit,
            and the menu, which always holds everything (spec 033). */}
        <div className="flex shrink-0 items-center gap-2">
          {selectedProgramId && (
            /* The "Program" label was an absolutely-positioned float (-top-4)
               that hung above the bar (spec 006 §F4). It's now an sr-only label
               — the selected major name in the control is self-explanatory, and
               screen readers still get the field name. */
            <div className="relative">
              <label htmlFor="program-select" className="sr-only">
                Program
              </label>
              <select
                id="program-select"
                value={selectedProgramId ?? ""}
                onChange={handleProgramChange}
                disabled={loading}
                // Capped width: a native select sizes to its LONGEST option
                // ("Information Science, Systems, and Technology, B.S.").
                // Long names truncate.
                title={programs.find((p) => p.id === selectedProgramId)?.name}
                className="max-w-[15rem] cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface py-1.5 pl-3 pr-8 t-body outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:opacity-50"
              >
                {groups.length > 1 ? (
                  <>
                    {ungrouped.map(option)}
                    {groups.map((g) => (
                      <optgroup key={g.college.id} label={g.college.shortName}>
                        {g.programs.map(option)}
                      </optgroup>
                    ))}
                  </>
                ) : (
                  pickable.map(option)
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
            </div>
          )}

          {error && <CatalogRetryButton />}

          {fits && <TopBarShortcuts />}
          <TopBarMenu />
        </div>
      </div>
    </div>
  );
}
