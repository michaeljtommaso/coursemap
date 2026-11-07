import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check, CircleHelp, ExternalLink, GraduationCap, LogIn, Moon, Share2, Sun, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlan } from "@/hooks/usePlan";
import { useSharePlan } from "@/hooks/useSharePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useTourStore } from "@/store/useTourStore";
import { FLOWCHART_YEAR } from "@/data/program-links";
import { useProgramLinks } from "@/components/layout/ProgramLinks";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { LEGEND_ENTRIES } from "@/components/layout/legendEntries";

/**
 * TopBarInline (spec 033 D8) — the top bar's controls laid out in the bar, for
 * the `full` and `compact` stages (TopBar measures which fits). Compact packs
 * the same controls tighter and drops the link buttons' words; past that, the
 * bar switches to TopBarMenu. Every control here is also in the menu, under
 * the same accessible name.
 */
export function TopBarInline({ compact }: { compact: boolean }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { isAnonymous } = useAuth();
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <div data-topbar-inline className={cn("flex shrink-0 items-center", compact ? "gap-1" : "gap-2")}>
      <MajorLinks compact={compact} />
      <ShareButton compact={compact} />
      {selectedProgramId && <ResetButton compact={compact} />}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCreditsOpen(true)}
        title="AP, IB, and transfer credit"
        aria-label="My credits"
        className={cn(compact && "px-2.5")}
      >
        <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
        My credits
      </Button>
      {isAnonymous ? (
        <Button
          data-tour="account"
          variant="outline"
          size="sm"
          onClick={() => setSignInOpen(true)}
          title="Sign in with Google to save your plan to your account"
          className={cn(compact && "px-2.5")}
        >
          <LogIn className="mr-1.5 h-3.5 w-3.5" />
          Sign in
        </Button>
      ) : (
        <AccountMenu />
      )}
      <LegendHelp />
      <Button variant="outline" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  );
}

/** Flowchart + Major page, and the twins stacked one above the other. */
function MajorLinks({ compact }: { compact: boolean }) {
  const { program, links, twins } = useProgramLinks();
  if (!program || (!links && twins.length === 0)) return null;
  const linkClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5", compact ? "px-2.5" : "px-3");
  // Two twins in one college would read the same; name the programs then.
  const sameCollege = new Set(twins.map((t) => t.college)).size < twins.length;
  return (
    <div data-tour="major-links" className={cn("flex items-center", compact ? "gap-1" : "gap-2")}>
      {links?.flowchart && (
        <a
          href={links.flowchart}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label="Flowchart"
          title={`Cornell's official ${FLOWCHART_YEAR} flowchart for ${program.name} (opens in a new tab)`}
        >
          <Workflow className="h-3.5 w-3.5" />
          {!compact && <span>Flowchart</span>}
        </a>
      )}
      {links && (
        <a
          href={links.majorPage}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label="Major page"
          title={`${program.name} on Cornell's website (opens in a new tab)`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {!compact && <span>Major page</span>}
        </a>
      )}
      {twins.length > 0 && (
        <div data-twins className="flex flex-col justify-center leading-tight">
          {twins.map((t) => {
            const text = sameCollege ? `${t.college}: ${t.name}` : `Also offered in ${t.college}`;
            const title = `Also offered in ${t.college}: ${t.name}`;
            return t.url ? (
              <a
                key={t.id}
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-[14rem] truncate px-1 t-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                title={`${title} (opens in a new tab)`}
              >
                {text}
              </a>
            ) : (
              <span key={t.id} className="max-w-[14rem] truncate px-1 t-meta text-ink-3" title={title}>
                {text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShareButton({ compact }: { compact: boolean }) {
  const { canShare, status, share } = useSharePlan();
  if (!canShare) return null;
  return (
    <Button
      data-tour="share"
      variant="outline"
      size="sm"
      onClick={() => void share()}
      disabled={status === "working"}
      aria-label="Share"
      title="Copy a read-only link — a frozen snapshot of your plan as it is right now"
      // Reserve the widest label state so the bar doesn't jump between states.
      className={cn("justify-center", compact ? "min-w-[6.75rem] px-2.5" : "min-w-[7.5rem]")}
    >
      {status === "copied" ? (
        <>
          <Check className="mr-1.5 h-3.5 w-3.5 text-complete-text" /> Link copied
        </>
      ) : status === "cooldown" ? (
        "Wait 30s"
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

/** Two-step inline Reset confirm (spec 003 §5.4); auto-reverts after 3s. The
 *  full stage reserves the confirm's width so arming it doesn't shove the bar. */
function ResetButton({ compact }: { compact: boolean }) {
  const { resetPlan } = usePlan();
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const arm = () => {
    setConfirming(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirming(false), 3000);
  };
  const cancel = () => {
    setConfirming(false);
    if (timer.current) clearTimeout(timer.current);
  };
  return (
    <div className={cn("flex items-center justify-end gap-1.5", !compact && "min-w-[13.5rem]")}>
      {confirming ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetPlan();
              cancel();
            }}
            className="border-destructive-text/30 bg-destructive-tint text-destructive-text hover:bg-destructive-text hover:text-destructive-tint"
          >
            Clear everything?
          </Button>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Keep it
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={arm} aria-label="Reset" className={cn(compact && "px-2.5")}>
          Reset
        </Button>
      )}
    </div>
  );
}

/**
 * LegendHelp (spec 014 D2) — the "?" button that shows the status legend.
 * Hover (mouse only) previews it; click pins/unpins it (so keyboard and touch
 * get it too); Esc or a click outside closes it. Rendered inside TopBar's
 * isolated stacking context, so it layers like the plan switcher's dropdown.
 */
function LegendHelp() {
  const navigate = useNavigate();
  const location = useLocation();
  const startTour = useTourStore((s) => s.start);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = pinned || hovering;

  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  useEffect(() => clearHideTimer, []);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovering(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      btnRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clearHideTimer();
        setHovering(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        // A short grace period lets the pointer cross the gap into the popover.
        clearHideTimer();
        hideTimer.current = setTimeout(() => setHovering(false), 150);
      }}
    >
      <Button
        ref={btnRef}
        variant="outline"
        size="icon"
        aria-label="Legend"
        aria-expanded={open}
        aria-controls="legend-popover"
        onClick={() => {
          // Click pins an open-by-hover popover; a second click closes it.
          if (pinned) {
            setPinned(false);
            setHovering(false);
          } else {
            setPinned(true);
          }
        }}
      >
        <CircleHelp className="h-4 w-4" />
      </Button>
      {open && (
        <div
          id="legend-popover"
          role="dialog"
          aria-label="Legend"
          className="absolute right-0 top-full z-[var(--z-sidebar-panel)] mt-1.5 w-64 rounded-lg border border-line bg-surface p-3 shadow-xl"
        >
          <p className="mb-2 t-label">Legend</p>
          <div className="flex flex-col gap-1.5">
            {LEGEND_ENTRIES.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <div className={cn("h-2 w-2 shrink-0 rounded-full", color)} />
                <span className="t-body">{label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setPinned(false);
              setHovering(false);
              if (location.pathname !== "/") navigate("/");
              startTour("planner");
            }}
            className="mt-3 w-full border-t border-line pt-2.5 text-left t-meta font-medium text-drop-text underline-offset-2 hover:underline"
          >
            Take the tour
          </button>
        </div>
      )}
    </div>
  );
}
