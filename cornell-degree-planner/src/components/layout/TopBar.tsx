import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { LogoMark } from "@/components/brand/LogoMark";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { ProgramStack } from "@/components/programs/ProgramStack";
import { TopBarMenu } from "@/components/layout/TopBarMenu";
import { TopBarInline } from "@/components/layout/TopBarInline";
import { useTopBarStore, type TopBarTier } from "@/store/useTopBarStore";
import { CatalogRetryButton } from "@/components/layout/CatalogRetryButton";

/**
 * TopBar (spec 004) — the plan's identity lives here now: an inline-editable
 * plan name beside the brand ("Michael's CS Plan") and the program stack
 * (spec 047 D5: the plan's major, second major and minors; "Change major"
 * lives in its panel), then the rest of the controls in one of three stages (spec 039 D8): spread
 * out (full), packed tighter (compact), or behind TopBarMenu once even the
 * compact row can't fit. The stage is measured, so the bar never overflows a
 * laptop and never covers the brand. Custom templates are deferred
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
          <Tooltip content="Rename your plan" placement="bottom">
          <button
            onClick={() => {
              setDraft(planName);
              setEditing(true);
            }}
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-2"
          >
            <span className="truncate t-body font-semibold">{planName}</span>
            <Pencil className="h-3 w-3 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          </Tooltip>
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

/** Room the plan name keeps beside the logo before the controls step down a
 *  stage (px). */
const PLAN_NAME_ROOM = 180;

/**
 * The bar's stages, widest first. The published tier (spec 039 D8) is full,
 * compact or menu; compact has two steps so the program stack (spec 047 D5)
 * keeps its labels as long as it can: `compact` packs the other controls
 * tighter, `folded` also folds the stack's extra programs into rings, and
 * `menu` puts the rest behind the menu button (rings too). So a plan with
 * three or four programs still shows their names at a wide desktop; the stack
 * folds only when even the packed row with names doesn't fit.
 */
type Stage = "full" | "compact" | "folded" | "menu";
const STAGES: Stage[] = ["full", "compact", "folded", "menu"];
const TIER_OF: Record<Stage, TopBarTier> = { full: "full", compact: "compact", folded: "compact", menu: "menu" };

/**
 * Which stage the controls fit in (spec 039 D8). Measured, not a breakpoint:
 * starting from `full`, a stage steps down the moment the brand group (logo +
 * plan name) would get less than its room, and remembers how wide the bar had
 * to be for it; it steps back up once the bar is that wide again. Each change
 * re-measures right after it lands (and a ResizeObserver catches the rest), so
 * the cascade settles before the browser paints. Anything that changes the
 * controls' width (major, sign-in, the plan loading, the programs on it)
 * starts again from `full`.
 */
function useTopBarStage(resetKey: string) {
  const barRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("full");
  // Bar width each stage needed, learned when it stopped fitting.
  const needed = useRef<Record<Stage, number>>({ full: 0, compact: 0, folded: 0, menu: 0 });
  const checkRef = useRef<() => void>(() => {});
  // The stage the bar is drawn in right now, so a measurement taken before a
  // pending step lands is never applied on top of it (mount runs both effects
  // below against the same layout; acting on both would skip a stage).
  const drawn = useRef<Stage>("full");

  useLayoutEffect(() => {
    const bar = barRef.current;
    const brand = brandRef.current;
    if (!bar || !brand || typeof ResizeObserver === "undefined") return;
    needed.current = { full: 0, compact: 0, folded: 0, menu: 0 };
    let fresh = true;
    const check = () => {
      const logo = brand.querySelector("h1")?.getBoundingClientRect().width ?? 0;
      const want = logo + 12 + PLAN_NAME_ROOM;
      const have = brand.getBoundingClientRect().width;
      const width = bar.clientWidth;
      const measuredAt = drawn.current;
      setStage((was) => {
        if (!fresh && was !== measuredAt) return was;
        const shown: Stage = fresh ? "full" : was;
        fresh = false;
        const i = STAGES.indexOf(shown);
        if (have < want && shown !== "menu") {
          needed.current[shown] = width + (want - have);
          return STAGES[i + 1];
        }
        if (shown !== "full" && width >= needed.current[STAGES[i - 1]]) return STAGES[i - 1];
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

  useLayoutEffect(() => {
    drawn.current = stage;
    checkRef.current();
  }, [stage]);

  // Published for the tour, which opens the menu when the bar is in it.
  const tier = TIER_OF[stage];
  const publish = useTopBarStore((s) => s.setTier);
  useEffect(() => publish(tier), [tier, publish]);

  return { barRef, brandRef, stage, tier };
}

export function TopBar() {
  const { error } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { isAnonymous } = useAuth();
  const { planId, additionalPrograms } = usePlan();
  // The stack's width changes with the programs on the plan: re-measure.
  const programsKey = additionalPrograms.map((p) => p.programId).join(",");
  const { barRef, brandRef, stage, tier } = useTopBarStage(
    `${selectedProgramId}|${isAnonymous}|${planId}|${programsKey}`
  );

  return (
    <div className="border-b border-line bg-surface/90 backdrop-blur">
      {/* Symmetric vertical padding, centered to --topbar-h (spec 006 §F4) —
          was pb-3/pt-6, which sat the row off-center. */}
      <div
        ref={barRef}
        data-topbar-tier={tier}
        data-topbar-stage={stage}
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

        {/* Controls: the program stack (spec 047 D5: one segment per
            program, replacing the major select; folded to rings only once
            the packed row with names doesn't fit), then the rest inline
            (full or compact) or behind the menu, whichever fits (spec 039 D8). */}
        <div className="flex shrink-0 items-center gap-2">
          <ProgramStack folded={stage === "folded" || stage === "menu"} />

          {error && <CatalogRetryButton />}

          {tier === "menu" ? <TopBarMenu /> : <TopBarInline compact={tier === "compact"} />}
        </div>
      </div>
    </div>
  );
}
