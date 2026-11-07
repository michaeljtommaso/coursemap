import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { animate, stagger } from "animejs";
import {
  Check, CirclePlay, ExternalLink, GraduationCap, LogIn, LogOut, Moon, RotateCcw, Share2, Sun,
  Workflow, CircleHelp, Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/motion";
import { useAuth } from "@/contexts/AuthProvider";
import { accountIdentity } from "@/lib/authSnapshot";
import { usePlan } from "@/hooks/usePlan";
import { useSharePlan } from "@/hooks/useSharePlan";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useTourStore } from "@/store/useTourStore";
import { useTopBarStore } from "@/store/useTopBarStore";
import { FLOWCHART_YEAR } from "@/data/program-links";
import { useProgramLinks } from "@/components/layout/ProgramLinks";
import { LEGEND_ENTRIES } from "@/components/layout/legendEntries";

/**
 * TopBarMenu (spec 033 D8) — the top bar's `menu` stage: when even the compact
 * row won't fit, every control past the major picker sits behind one button: the major's
 * links (twins stacked), Share, My credits, Reset, sign-in / account, the status
 * legend, the tour and the theme.
 *
 * Opening it is a small show, not a slide: the three bars fold into an X, the
 * panel opens as a circle growing out of the button, and the rows rise in one
 * after another. Under reduced motion it simply appears.
 */

const PANEL_W = 312;
const GAP = 8;

export function TopBarMenu() {
  const open = useTopBarStore((s) => s.menuOpen);
  const setOpen = useTopBarStore((s) => s.setMenuOpen);
  const [pos, setPos] = useState<{ top: number; right: number; ox: number; oy: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const close = () => {
    const panel = panelRef.current;
    if (!panel || !pos || closing.current || prefersReducedMotion() || !panel.animate) {
      setOpen(false);
      return;
    }
    closing.current = true;
    const at = `at ${pos.ox}px ${pos.oy}px`;
    const anim = panel.animate(
      [{ clipPath: `circle(${reach(panel, pos)}px ${at})` }, { clipPath: `circle(0px ${at})` }],
      { duration: 240, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
    );
    anim.onfinish = () => {
      closing.current = false;
      setOpen(false);
    };
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    // The circle grows from the button's centre, measured in the panel's box.
    setPos({ top: r.bottom + GAP, right, ox: PANEL_W - r.width / 2, oy: -GAP - r.height / 2 });
  }, [open]);

  // The opening show.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !pos || !panel || prefersReducedMotion()) return;
    const at = `at ${pos.ox}px ${pos.oy}px`;
    panel.animate?.(
      [{ clipPath: `circle(0px ${at})` }, { clipPath: `circle(${reach(panel, pos)}px ${at})` }],
      { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" }
    );
    const rows = panel.querySelectorAll<HTMLElement>("[data-menu-row]");
    animate(rows, {
      opacity: [0, 1],
      y: [12, 0],
      scale: [0.97, 1],
      delay: stagger(26, { start: 90 }),
      duration: 340,
      ease: "out(3)",
    });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      btnRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      // The tour opens this menu to point at it; clicks on its overlay
      // belong to the tour.
      if ((t as Element).closest?.('[aria-label="Planner tour"]')) return;
      close();
    };
    const onResize = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  return (
    <>
      <button
        ref={btnRef}
        data-tour="menu"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Share, sign in, credits, links and settings"
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface transition-colors hover:bg-surface-2",
          open && "border-ink bg-surface-2"
        )}
      >
        <Burger open={open} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Menu"
            style={{ position: "fixed", top: pos.top, right: pos.right, width: PANEL_W }}
            className="z-[var(--z-modal)] flex max-h-[calc(100vh-5rem)] flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-2 shadow-2xl"
          >
            <MenuBody onDone={() => setOpen(false)} />
          </div>,
          document.body
        )}
    </>
  );
}

/** Radius that covers the whole panel from the button's centre. */
function reach(panel: HTMLElement, pos: { ox: number; oy: number }): number {
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const dx = Math.max(pos.ox, w - pos.ox);
  const dy = Math.max(Math.abs(pos.oy), h - pos.oy);
  return Math.ceil(Math.hypot(dx, dy));
}

/** Three bars that fold into an X. Whole-pixel geometry (2px bars at 0, 5
 *  and 10px in a 12px box) so they render crisp on any display scale. */
function Burger({ open }: { open: boolean }) {
  const bar =
    "absolute left-0 h-[2px] w-4 rounded-full bg-ink transition-[transform,opacity] duration-300 ease-[cubic-bezier(.16,1,.3,1)]";
  return (
    <span aria-hidden className="relative block h-3 w-4">
      <span className={cn(bar, "top-0", open && "translate-y-[5px] rotate-45")} />
      <span className={cn(bar, "top-[5px]", open && "scale-x-0 opacity-0")} />
      <span className={cn(bar, "top-[10px]", open && "-translate-y-[5px] -rotate-45")} />
    </span>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <p data-menu-row className="px-2.5 pb-0.5 pt-1 t-label text-ink-4">
        {label}
      </p>
      {children}
    </div>
  );
}

const ROW =
  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

function Row({
  icon,
  label,
  sub,
  onClick,
  href,
  ariaLabel,
  disabled,
  trailing,
  dataTour,
}: {
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  href?: string;
  ariaLabel?: string;
  disabled?: boolean;
  trailing?: ReactNode;
  dataTour?: string;
}) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate t-body font-semibold text-ink">{label}</span>
        {sub && <span className="truncate t-meta text-ink-3">{sub}</span>}
      </span>
      {trailing}
    </>
  );
  return href ? (
    <a
      data-menu-row
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={ROW}
    >
      {inner}
      <ExternalLink className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
    </a>
  ) : (
    <button
      data-menu-row
      data-tour={dataTour}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(ROW, "disabled:opacity-60")}
    >
      {inner}
    </button>
  );
}

function MenuBody({ onDone }: { onDone: () => void }) {
  const { program, links, twins } = useProgramLinks();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { resetPlan } = usePlan();
  const { canShare, status, share } = useSharePlan();
  const { isAnonymous, user, firstName, signOut } = useAuth();
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const startTour = useTourStore((s) => s.start);
  const navigate = useNavigate();
  const location = useLocation();

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const identity = accountIdentity(user);
  const name = identity.displayName ?? firstName ?? "Your account";

  const shareLabel =
    status === "copied"
      ? "Link copied"
      : status === "cooldown"
        ? "Wait 30s"
        : status === "failed"
          ? "Couldn't share"
          : status === "working"
            ? "Sharing…"
            : "Share";

  return (
    <>
      {program && (links || twins.length > 0) && (
        <Section label="Your major">
          {links?.flowchart && (
            <Row
              icon={<Workflow className="h-4 w-4" />}
              label="Flowchart"
              ariaLabel="Flowchart"
              sub={`Cornell's official ${FLOWCHART_YEAR} flowchart`}
              href={links.flowchart}
            />
          )}
          {links && (
            <Row
              icon={<ExternalLink className="h-4 w-4" />}
              label="Major page"
              ariaLabel="Major page"
              sub={`${program.name} on Cornell's website`}
              href={links.majorPage}
            />
          )}
          {twins.map((t) =>
            t.url ? (
              <Row
                key={t.id}
                icon={<Landmark className="h-4 w-4" />}
                label={`Also offered in ${t.college}`}
                sub={t.name}
                href={t.url}
              />
            ) : (
              <div key={t.id} data-menu-row className="px-2.5 py-1.5 t-meta text-ink-3">
                Also offered in {t.college}: {t.name}
              </div>
            )
          )}
        </Section>
      )}

      {selectedProgramId && (
        <Section label="Your plan">
          {canShare && (
            <Row
              icon={status === "copied" ? <Check className="h-4 w-4 text-complete-text" /> : <Share2 className="h-4 w-4" />}
              label={shareLabel}
              ariaLabel="Share"
              dataTour="share"
              sub="Copies a read-only link to your plan"
              onClick={() => void share()}
              disabled={status === "working"}
            />
          )}
          <Row
            icon={<GraduationCap className="h-4 w-4" />}
            label="My credits"
            ariaLabel="My credits"
            sub="AP, IB and transfer credit"
            onClick={() => {
              onDone();
              setCreditsOpen(true);
            }}
          />
          {confirmingReset ? (
            <div data-menu-row className="flex items-center gap-1.5 px-1 py-1">
              <button
                type="button"
                onClick={() => {
                  resetPlan();
                  setConfirmingReset(false);
                  onDone();
                }}
                className="flex-1 rounded-lg bg-destructive-tint px-3 py-2 t-label text-destructive-text transition-colors hover:bg-destructive-text hover:text-destructive-tint"
              >
                Clear everything?
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="rounded-lg px-3 py-2 t-label text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <Row
              icon={<RotateCcw className="h-4 w-4" />}
              label="Reset"
              ariaLabel="Reset"
              sub="Start this plan over"
              onClick={() => setConfirmingReset(true)}
            />
          )}
        </Section>
      )}

      <Section label="Account">
        {isAnonymous ? (
          <Row
            icon={<LogIn className="h-4 w-4" />}
            label="Sign in"
            ariaLabel="Sign in"
            dataTour="account"
            sub="With Google, to keep your plan on any device"
            onClick={() => {
              onDone();
              setSignInOpen(true);
            }}
          />
        ) : (
          <>
            <div data-menu-row data-account={name} data-tour="account" className="flex items-center gap-3 px-2.5 py-2">
              <Avatar photo={identity.photoURL} initial={(firstName ?? name).charAt(0).toUpperCase()} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate t-body font-semibold">{name}</span>
                {identity.email && <span className="truncate t-meta text-ink-4">{identity.email}</span>}
              </div>
            </div>
            {confirmingSignOut ? (
              <div data-menu-row className="flex items-center gap-1.5 px-1 py-1">
                <button
                  type="button"
                  onClick={async () => {
                    onDone();
                    await signOut();
                  }}
                  className="flex-1 rounded-lg bg-destructive-tint px-3 py-2 t-label text-destructive-text transition-colors hover:bg-destructive-text hover:text-destructive-tint"
                >
                  Sign out?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(false)}
                  className="rounded-lg px-3 py-2 t-label text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  Stay
                </button>
              </div>
            ) : (
              <Row
                icon={<LogOut className="h-4 w-4" />}
                label="Sign out"
                ariaLabel="Sign out"
                onClick={() => setConfirmingSignOut(true)}
              />
            )}
          </>
        )}
      </Section>

      {legendOpen && (
        <div data-menu-row className="mx-1 mb-1 flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5">
          {LEGEND_ENTRIES.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={cn("h-2 w-2 shrink-0 rounded-full", color)} />
              <span className="t-meta text-ink-2">{label}</span>
            </div>
          ))}
        </div>
      )}

      <div data-menu-row className="mt-1 grid grid-cols-3 gap-1 border-t border-line pt-2">
        <FootButton
          icon={<CircleHelp className="h-4 w-4" />}
          label="Legend"
          pressed={legendOpen}
          onClick={() => setLegendOpen((v) => !v)}
        />
        <FootButton
          icon={<CirclePlay className="h-4 w-4" />}
          label="Take the tour"
          short="Tour"
          onClick={() => {
            onDone();
            if (location.pathname !== "/") navigate("/");
            startTour("planner");
          }}
        />
        <FootButton
          icon={theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          label="Toggle theme"
          short={theme === "dark" ? "Light" : "Dark"}
          onClick={toggleTheme}
        />
      </div>
    </>
  );
}

function FootButton({
  icon,
  label,
  short,
  onClick,
  pressed,
}: {
  icon: ReactNode;
  label: string;
  short?: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg px-1 py-2 t-meta text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink",
        pressed && "bg-surface-2 text-ink"
      )}
    >
      {icon}
      {short ?? label}
    </button>
  );
}

/** Google avatar with a graceful initial fallback (no photo, or a load error). */
function Avatar({ photo, initial }: { photo: string | null; initial: string }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-drop-tint t-label text-drop-text">
      {initial}
    </span>
  );
}

