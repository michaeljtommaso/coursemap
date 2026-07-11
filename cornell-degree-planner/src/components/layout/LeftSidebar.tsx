import { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, LogIn, LogOut, Map as MapIcon, LibraryBig, GraduationCap } from "lucide-react";
import { NavLink } from "react-router-dom";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/contexts/AuthProvider";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useMajorMatch } from "@/hooks/useMajorMatch";
import { slotCredits, classOfYear } from "@/lib/planner/semesters";
import { cn } from "@/lib/utils";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * LeftSidebar (spec 004 "intimate") — the journey rail. Progress is framed as
 * a journey ("62 of 120 credits — halfway there"), the timeline is THEIRS
 * (Class of 2030), and the Major Match teaser deep-links into the Majors tab.
 */

function journeyPhrase(pct: number): string {
  if (pct <= 0) return "The first step is marking a course done.";
  if (pct < 25) return "Just getting started.";
  if (pct < 50) return "Building momentum.";
  if (pct < 60) return "Halfway there.";
  if (pct < 85) return "Past the halfway mark — keep going.";
  if (pct < 100) return "The home stretch.";
  return "Every requirement, done.";
}

/**
 * AccountButton (spec 006 §C3 / triage #8) — standard shell placement, bottom
 * of the left rail (house-standard reference). Anonymous: a quiet "Sign in" row that
 * opens the SignInDialog. Signed-in: the Google avatar + first name, opening a
 * small portal menu (the CardOverflowMenu idiom — portal, fixed anchor, closes
 * on Esc / outside-click / scroll) whose header shows displayName + email and
 * whose one action is Sign out behind a two-step inline confirm (the app idiom).
 */
function AccountButton() {
  const { user, isAnonymous, firstName, signOut } = useAuth();
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Open UPWARD from the trigger (it lives at the bottom of the rail).
    setPos({ bottom: window.innerHeight - r.top + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  // Reset the two-step confirm whenever the menu closes.
  useEffect(() => {
    if (!open) setConfirmingSignOut(false);
  }, [open]);

  if (isAnonymous) {
    // Anonymous users still get "My credits" (spec 007 §2b): the credit
    // profile lives on the anon uid's profile doc (rules only require auth),
    // and the falsely-blocked-on-AP freshman is exactly the student who
    // hasn't signed in yet — the fix path must not hide behind Google.
    return (
      <div className="flex flex-col gap-1">
        <button
          onClick={() => setCreditsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-drop hover:bg-drop-tint/40"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3">
            <GraduationCap className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="t-body font-semibold">My credits</span>
            <span className="t-meta text-ink-4">AP, IB, and transfer credit</span>
          </span>
        </button>
        <button
          onClick={() => setSignInOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-drop hover:bg-drop-tint/40"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3">
            <LogIn className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="t-body font-semibold">Sign in</span>
            <span className="t-meta text-ink-4">Save your plan to your account</span>
          </span>
        </button>
      </div>
    );
  }

  const name = user?.displayName ?? firstName ?? "Your account";
  const email = user?.email ?? null;
  const photo = user?.photoURL ?? null;
  const initial = (firstName ?? name ?? "?").charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Avatar photo={photo} initial={initial} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate t-body font-semibold">{firstName ?? name}</span>
          <span className="t-meta text-ink-4">Signed in</span>
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", bottom: pos.bottom, left: pos.left }}
            className="z-[var(--z-modal)] min-w-[208px] rounded-lg border border-line bg-surface p-1.5 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar photo={photo} initial={initial} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate t-body font-semibold">{name}</span>
                {email && <span className="truncate t-meta text-ink-4">{email}</span>}
              </div>
            </div>
            <div className="my-1 border-t border-line/60" />
            {/* "My credits" (spec 007 §2b/§5, Unit 7C2) — the always-editable
                entry point into the credit profile, demoted below the divider
                like the rest of the account-scoped actions. */}
            <button
              role="menuitem"
              onClick={() => { setOpen(false); setCreditsOpen(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              My credits
            </button>
            {confirmingSignOut ? (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <button
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    await signOut();
                  }}
                  className="flex-1 rounded-md bg-destructive-tint px-2 py-1.5 t-label text-destructive-text transition-colors hover:bg-destructive-text hover:text-destructive-tint"
                >
                  Sign out?
                </button>
                <button
                  onClick={() => setConfirmingSignOut(false)}
                  className="rounded-md px-2 py-1.5 t-label text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  Stay
                </button>
              </div>
            ) : (
              <button
                role="menuitem"
                onClick={() => setConfirmingSignOut(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            )}
          </div>,
          document.body
        )}
    </>
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
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-drop-tint t-label text-drop-text">
      {initial}
    </span>
  );
}

const YEAR_OPTIONS = [2023, 2024, 2025, 2026];

export function LeftSidebar({ slots }: { slots: ProgramSlotWithData[] }) {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  // PINNED CONTRACT (spec 006 §B.1): inProgressSlotIds lands on the same plan
  // context completedSlotIds/waivedSlotIds already come from. It is read
  // here, never derived — "in progress" is a manual state, not engine output.
  const { completedSlotIds, waivedSlotIds, inProgressSlotIds, slotSelections, selectedCourses } =
    usePlan();
  const { enteringYear, setEnteringYear } = useAuth();
  const { programs } = usePrograms();
  const { matches, ready } = useMajorMatch(slots);

  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  const totalCredits = program?.total_credits ?? 120;

  const { earnedCredits, inProgressCredits, doneSlots } = useMemo(() => {
    let credits = 0;
    let inProgress = 0;
    let done = 0;
    const completedSet = new Set(completedSlotIds);
    const waivedSet = new Set(waivedSlotIds);
    const inProgressSet = new Set(inProgressSlotIds);
    for (const slot of slots) {
      if (waivedSet.has(slot.id)) done++;
      // In progress does NOT count as earned/done (spec 006 §B.1) — it's
      // tallied separately, same credit calc as earned, own bucket.
      if (inProgressSet.has(slot.id)) {
        const placedId = slotSelections[slot.id];
        const placed = placedId ? (selectedCourses[placedId] ?? null) : null;
        const cr = slotCredits(slot, placed);
        if (cr) inProgress += cr.min;
      }
      if (!completedSet.has(slot.id)) continue;
      done++;
      const placedId = slotSelections[slot.id];
      const placed = placedId ? (selectedCourses[placedId] ?? null) : null;
      const cr = slotCredits(slot, placed);
      if (cr) credits += cr.min;
    }
    return { earnedCredits: credits, inProgressCredits: inProgress, doneSlots: done };
  }, [slots, completedSlotIds, waivedSlotIds, inProgressSlotIds, slotSelections, selectedCourses]);

  const pct = totalCredits > 0 ? Math.min(100, Math.round((earnedCredits / totalCredits) * 100)) : 0;
  const gradYear = classOfYear(enteringYear);
  const topMatch = ready ? matches[0] : null;

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-line bg-surface/60 px-4 py-5">
      {/* Nav (spec 006 §E1) — Planner ↔ Classes directory */}
      <nav className="flex flex-col gap-0.5">
        {[
          { to: "/", label: "Planner", Icon: MapIcon, end: true },
          { to: "/classes", label: "Classes", Icon: LibraryBig, end: false },
        ].map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 t-body font-medium transition-colors",
                isActive
                  ? "bg-surface-2 text-ink"
                  : "text-ink-3 hover:bg-surface-2/60 hover:text-ink"
              )
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Journey */}
      <section>
        <p className="mb-2 t-label">Your journey</p>
        {selectedProgramId && slots.length > 0 ? (
          <>
            <p className="t-body font-semibold">
              <span className="num">{earnedCredits}</span> of{" "}
              <span className="num">{totalCredits}</span> credits
            </p>
            {inProgressCredits > 0 && (
              <p className="mt-0.5 t-meta text-ink-3">
                <span className="num">{earnedCredits}</span> earned ·{" "}
                <span className="num">{inProgressCredits}</span> in progress
              </p>
            )}
            <div className="mb-1.5 mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-complete transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="t-meta">{journeyPhrase(pct)}</p>
            <p className="mt-1.5 t-meta text-ink-4">
              <span className="num">{doneSlots}</span> of{" "}
              <span className="num">{slots.length}</span> requirements settled
            </p>
          </>
        ) : (
          <p className="t-meta">Pick a program and this becomes your road home.</p>
        )}
      </section>

      {/* Timeline */}
      <section>
        <p className="mb-2 t-label">Your timeline</p>
        {enteringYear ? (
          <p className="t-body">
            <span className="num">{enteringYear}</span> –{" "}
            <span className="num">{gradYear}</span>
            <span className="mt-0.5 block t-meta">
              Class of <span className="num">{gradYear}</span>
            </span>
          </p>
        ) : (
          <>
            <p className="mb-1.5 t-meta">When did you start at Cornell?</p>
            <div className="flex flex-wrap gap-1">
              {YEAR_OPTIONS.map((y) => (
                <button
                  key={y}
                  onClick={() => void setEnteringYear(y)}
                  className="rounded-full border border-line bg-surface px-2 py-0.5 t-meta transition-colors hover:border-drop hover:bg-drop-tint"
                >
                  <span className="num">{y}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Legend */}
      <section>
        <p className="mb-2 t-label">Legend</p>
        <div className="flex flex-col gap-1.5">
          {/* One entry per state in the spec-006/007 model, mirroring
              SlotCard's rail/tint tokens: manual states first, then
              engine-derived. The amber `available` token now reads as
              Warning on cards; plain Available renders neutral (no rail),
              hence the muted dot. Advisory (spec 007 §1b) is a QUIET neutral
              ink dot — distinct from Available's lighter ink-4 — never red/
              amber. Overlap shares Warning's amber family by design (both are
              "heads up," not "you can't") but renders as an OUTLINED amber
              dot so the two rows stay visually distinct — the `color` slot
              takes the dot's full class string, solid fills by default. */}
          {[
            { label: "Completed", color: "bg-complete" },
            { label: "In progress", color: "bg-drop" },
            { label: "Waived", color: "bg-waived" },
            { label: "Available", color: "bg-ink-4" },
            { label: "Blocked — needs prereqs", color: "bg-destructive" },
            { label: "Warning — term or credits", color: "bg-available" },
            { label: "Advisory — may be satisfied by credit", color: "bg-ink-3" },
            {
              label: "Overlap — credit for only one",
              color: "border-[1.5px] border-available bg-transparent",
            },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
              <span className="t-body">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Major Match teaser → Majors tab */}
      <section>
        <p className="mb-2 t-label">Major Match</p>
        {topMatch && topMatch.matched > 0 ? (
          <button
            onClick={() => openPanel("majors")}
            className="group flex w-full flex-col gap-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-drop"
          >
            <span className="flex items-baseline justify-between">
              <span className="t-body font-semibold">
                {topMatch.program.short_name ?? topMatch.program.name}
              </span>
              <span className="num t-body font-semibold">{topMatch.pct}%</span>
            </span>
            <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-complete transition-all duration-500"
                style={{ width: `${topMatch.pct}%` }}
              />
            </span>
            <span className="flex items-center gap-1 t-meta text-ink-3 transition-colors group-hover:text-ink">
              See every major <ArrowRight className="h-2.5 w-2.5" />
            </span>
          </button>
        ) : (
          <button
            onClick={() => openPanel("majors")}
            className="w-full rounded-lg border border-dashed border-line px-2.5 py-2 text-left t-meta text-ink-3 transition-colors hover:border-drop hover:text-ink"
          >
            Your courses will point at a major — complete a few and look here.
          </button>
        )}
      </section>

      {/* Footer: catalog line + account (standard shell placement, spec 006 §C3). */}
      <div className="mt-auto flex flex-col gap-2">
        {program && (
          <p className="t-meta text-ink-4">
            {program.college} · <span className="num">{program.catalog_year}</span> catalog
          </p>
        )}
        <AccountButton />
      </div>
    </aside>
  );
}
