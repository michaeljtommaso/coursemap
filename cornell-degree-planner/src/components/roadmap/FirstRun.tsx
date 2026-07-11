import { useState } from "react";
import { RotateCw, PencilRuler, GraduationCap, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/LogoMark";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useAuth } from "@/contexts/AuthProvider";
import { CREDIT_EQUIVALENCIES, toCreditEntry } from "@/data/credit-equivalencies";
import type { Program } from "@/types/db";

/** The seeded blank-canvas program (spec 006 §F5). Kept out of the majors grid
 *  and offered as its own card. A synthetic fallback lets the card resolve a
 *  Program object even before the seed script has been run (see
 *  scripts/seed-blank-program.ts); once seeded, the real doc is preferred. */
const BLANK_ID = "blank";
const SYNTHETIC_BLANK: Program = {
  id: BLANK_ID,
  name: "Start from scratch",
  short_name: "Blank",
  college: "Your own plan",
  catalog_year: 2025,
  total_credits: null,
  affiliation_text: null,
  created_at: new Date(0).toISOString(),
};

/**
 * FirstRun (spec 004 §3 + spec 011 §3) — the empty canvas is the pitch, not a
 * shrug, and it now opens with the thesis's honest question: two equal-weight
 * doors. "I know my major" runs the existing template flow (program grid → year
 * → credit step). "Still figuring it out" skips the grid entirely — year →
 * credit → a blank canvas with the discovery panel already on the Majors tab,
 * so the ranking reacts from the first placed course. A faint ghost roadmap
 * breathes behind everything: the empty state previews the product.
 */

function GhostRoadmap() {
  // Static, faint, decorative — border-faint only, no saturated color.
  const cols = [0, 1, 2, 3, 4, 5];
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      aria-hidden="true"
    >
      {cols.map((c) =>
        [0, 1, 2, 3].map((r) => (
          <rect
            key={`${c}-${r}`}
            x={60 + c * 240}
            y={70 + r * 120}
            width={190}
            height={78}
            rx={8}
            fill="none"
            stroke="var(--border-faint)"
            strokeWidth={1.5}
          />
        ))
      )}
      {[0, 1, 2].map((c) => (
        <path
          key={c}
          d={`M ${60 + c * 240 + 190} ${70 + 39 + c * 120} C ${60 + (c + 1) * 240 - 25} ${70 + 39 + c * 120}, ${60 + (c + 1) * 240 - 25} ${70 + 39 + (c + 1) * 120}, ${60 + (c + 1) * 240} ${70 + 39 + (c + 1) * 120}`}
          fill="none"
          stroke="var(--border-faint)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

const YEAR_OPTIONS = [2023, 2024, 2025, 2026];

export function FirstRun() {
  const { programs, loading, error, refetch } = usePrograms();
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  const { enteringYear, setEnteringYear, setCreditProfile } = useAuth();

  // Which door the student chose (spec 011 §3). null = the two-doors screen is
  // showing. "known" reveals the majors grid; "discover" heads straight into the
  // year/credit steps toward the blank canvas.
  const [door, setDoor] = useState<"known" | "discover" | null>(null);
  const discovering = door === "discover";

  const [pendingProgram, setPendingProgram] = useState<Program | null>(null);
  // Credit step (spec 007 §2b/§5b, Unit 7C2) — a third step after the year
  // question, before commit(): "Arriving with AP/IB credit?" Skippable, and
  // only shown on the brand-new-user path (pendingProgram is only ever set
  // there); a returning user (enteringYear already known) still goes straight
  // to the roadmap via the fast path below, unchanged.
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [selectedCredits, setSelectedCredits] = useState<Set<string>>(new Set());
  // Save state for the credit write (SignInDialog's idle|loading|error idiom):
  // a failed write must NOT strand onboarding — surface a quiet inline error
  // and keep both "Skip for now" and retry one click away.
  const [creditStatus, setCreditStatus] = useState<"idle" | "saving" | "error">("idle");

  // The blank canvas is a real program too — prefer its seeded doc, fall back to
  // the synthetic one so the discovery door works pre-seed (spec 006 §F5).
  const blankProgram = programs.find((p) => p.id === BLANK_ID) ?? SYNTHETIC_BLANK;
  // Keep "blank" out of the majors pill grid — the discovery door owns it now.
  const majorPrograms = programs.filter((p) => p.id !== BLANK_ID);

  const commit = (program: Program, year: number | null) => {
    if (year) void setEnteringYear(year);
    // The discovery door lands on the blank canvas with the ranking already in
    // view (spec 011 §3) — open the panel on the Majors tab so the first placed
    // course visibly moves the list.
    if (discovering) openPanel("majors");
    setSelectedProgramId(program.id);
  };

  const pickProgram = (program: Program) => {
    // Already know their year (returning user)? Straight to the roadmap.
    if (enteringYear) commit(program, null);
    else setPendingProgram(program);
  };

  /** Door 1 — "I know my major": reveal the existing program grid. */
  const chooseKnown = () => setDoor("known");

  /** Door 2 — "Still figuring it out": no program pick — head into the year/
   *  credit steps toward the blank canvas. A returning user (year known) skips
   *  straight to the credit step, which is skippable either way. */
  const chooseDiscover = () => {
    setDoor("discover");
    setPendingProgram(blankProgram);
    if (enteringYear) {
      setPendingYear(null);
      setShowCredits(true);
    }
  };

  /** Back to the two-doors screen (from the grid or the year step). */
  const backToDoors = () => {
    setDoor(null);
    setPendingProgram(null);
    setPendingYear(null);
    setShowCredits(false);
  };

  /** Year step resolved (chosen or skipped) — advance to the credit step
   *  rather than committing immediately. */
  const advanceToCredits = (year: number | null) => {
    setPendingYear(year);
    setShowCredits(true);
  };

  const toggleCredit = (id: string) => {
    setSelectedCredits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Credit step resolved (saved or skipped) — commit and land on the roadmap.
   *  A failed save stays on the step with an inline error (selections intact);
   *  "Skip for now" always works, so onboarding can never be stranded. */
  const finishCredits = async (save: boolean) => {
    if (!pendingProgram || creditStatus === "saving") return;
    if (save && selectedCredits.size > 0) {
      setCreditStatus("saving");
      const entries = CREDIT_EQUIVALENCIES.filter((e) => selectedCredits.has(e.id)).map(
        toCreditEntry
      );
      try {
        await setCreditProfile(entries);
      } catch (err) {
        console.warn("[first-run] setCreditProfile failed", err);
        setCreditStatus("error");
        return;
      }
    }
    setCreditStatus("idle");
    commit(pendingProgram, pendingYear);
    setPendingProgram(null);
    setShowCredits(false);
    setSelectedCredits(new Set());
  };

  // Render phase. The discovery door always sets pendingProgram (→ year/credit
  // steps), so an unset pendingProgram means either the majors grid ("known"
  // door) or the two-doors screen (no door yet).
  const creditStep = !!pendingProgram && showCredits;
  const yearStep = !!pendingProgram && !showCredits;
  const majorsGrid = !pendingProgram && door === "known";
  const doorsScreen = !pendingProgram && door === null;
  // The year/credit steps label the pending choice — the blank program reads as
  // the discovery intent, not "Blank".
  const stepLabel = discovering
    ? "Still figuring it out"
    : (pendingProgram?.short_name ?? pendingProgram?.name);

  return (
    <div className="absolute inset-0 overflow-auto">
      <GhostRoadmap />
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 px-8 py-12">
        {/* Brand (Coursemap hero, claude-design-2026-07-11 logo option 4) */}
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark size={44} wordmark stacked />
          <p
            className="font-mono text-ink-3"
            style={{ fontSize: "0.5625rem", letterSpacing: "0.18em" }}
          >
            EVERYTHING LEADS SOMEWHERE
          </p>
        </div>

        {/* Heading — adapts to the phase (the year/credit steps carry their own
            centered prompt, so no big heading there). */}
        {!error && doorsScreen && (
          <div className="flex max-w-md flex-col items-center gap-2 text-center">
            <h2 className="t-headline text-[1.375rem]">Two ways in.</h2>
            <p className="t-body text-ink-2">
              Start from your major, or start from the courses you&apos;re drawn
              to. Either way it becomes your roadmap — and every change saves
              automatically.
            </p>
          </div>
        )}
        {!error && majorsGrid && (
          <div className="flex max-w-md flex-col items-center gap-2 text-center">
            <h2 className="t-headline text-[1.375rem]">Start with your program.</h2>
            <p className="t-body text-ink-2">
              See the whole path laid out — then make it yours.
            </p>
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive-tint px-5 py-4">
            <p className="t-body font-semibold text-destructive-text">
              We couldn&apos;t load the programs
            </p>
            <button
              onClick={refetch}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 t-label text-destructive-text transition-colors hover:bg-destructive/10"
            >
              <RotateCw className="h-3 w-3" />
              Try again
            </button>
          </div>
        ) : creditStep ? (
          /* Credit step — AP/IB/transfer credit (spec 007 §2b/§5b), skippable.
             Serves both doors (spec 011 §3). */
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="t-label">{stepLabel}</p>
              <p className="t-body text-ink-2">Arriving with AP, IB, or transfer credit?</p>
            </div>
            <div className="flex max-w-lg flex-wrap items-center justify-center gap-2">
              {CREDIT_EQUIVALENCIES.map((entry) => {
                const active = selectedCredits.has(entry.id);
                return (
                  <button
                    key={entry.id}
                    onClick={() => toggleCredit(entry.id)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-full border-[1.5px] px-3.5 py-1.5 t-body font-medium transition-colors",
                      active
                        ? "border-drop bg-drop-tint text-drop-text"
                        : "border-line bg-surface text-ink-2 hover:border-drop hover:bg-drop-tint/60"
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            {creditStatus === "error" && (
              <p className="t-meta text-destructive-text">
                Couldn&apos;t save your credits — check your connection and try again.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={() => void finishCredits(false)}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                Skip for now
              </button>
              <button
                onClick={() => void finishCredits(true)}
                disabled={creditStatus === "saving"}
                className="rounded-full border-[1.5px] border-ink bg-ink px-4 py-2 t-body font-semibold text-canvas transition-colors hover:opacity-90 disabled:opacity-60"
              >
                {creditStatus === "saving"
                  ? "Saving…"
                  : creditStatus === "error"
                    ? "Try again"
                    : "Save & continue"}
              </button>
            </div>
          </div>
        ) : yearStep ? (
          /* Year step — entering year (both doors) */
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="t-label">{stepLabel}</p>
              <p className="t-body text-ink-2">
                When did you start at Cornell? We&apos;ll label the semesters as
                <em> your</em> semesters.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {YEAR_OPTIONS.map((y) => (
                <button
                  key={y}
                  onClick={() => advanceToCredits(y)}
                  className="rounded-full border-[1.5px] border-line bg-surface px-4 py-2 t-body font-semibold transition-colors hover:border-drop hover:bg-drop-tint"
                >
                  <span className="num">Fall {y}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => advanceToCredits(null)}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                I&apos;ll add this later
              </button>
              <button
                onClick={() => (discovering ? backToDoors() : setPendingProgram(null))}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                Back
              </button>
            </div>
          </div>
        ) : majorsGrid ? (
          /* "I know my major" door — program pills (13 CoE majors) + blank card */
          <div className="flex w-full max-w-3xl flex-col gap-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {loading
                ? [0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-[76px] animate-pulse rounded-xl border border-line bg-surface-2/60"
                      aria-hidden="true"
                    />
                  ))
                : majorPrograms.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pickProgram(p)}
                      className={cn(
                        "group flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-left",
                        "transition-all hover:-translate-y-0.5 hover:border-drop hover:bg-drop-tint/60",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                      )}
                    >
                      <span className="t-label text-ink-4 transition-colors group-hover:text-drop-text">
                        {p.short_name ?? "Program"}
                      </span>
                      <span className="t-body font-semibold">{p.name}</span>
                      <span className="t-meta">
                        {p.college} · <span className="num">{p.catalog_year}</span> catalog
                      </span>
                    </button>
                  ))}
            </div>

            {/* Blank canvas (spec 006 §F5). NOW REDUNDANT with the "Still
                figuring it out" door (spec 011 §3), which is the first-class
                path to this same blank program — kept because it's harmless and
                still a valid shortcut from inside the grid. */}
            {!loading && (
              <button
                onClick={() => pickProgram(blankProgram)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line bg-surface/60 px-4 py-3 text-left",
                  "transition-all hover:-translate-y-0.5 hover:border-drop hover:bg-drop-tint/40",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3 transition-colors group-hover:text-drop-text">
                  <PencilRuler className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="t-body font-semibold">Start from a blank canvas</span>
                  <span className="t-meta">
                    No template — add your own classes. The Majors panel still
                    watches where they lead.
                  </span>
                </span>
              </button>
            )}

            <button
              onClick={backToDoors}
              className="self-center t-meta text-ink-3 underline-offset-2 hover:underline"
            >
              Back
            </button>
          </div>
        ) : (
          /* The two doors (spec 011 §3) — equal weight, the thesis's honest
             question on the first screen. */
          <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                onClick: chooseKnown,
                Icon: GraduationCap,
                title: "I know my major",
                sub: "Start from your program's template and make it your own.",
              },
              {
                onClick: chooseDiscover,
                Icon: Compass,
                title: "Still figuring it out",
                sub: "Start from a blank canvas — add classes you're drawn to and watch which majors they add up to.",
              },
            ].map(({ onClick, Icon, title, sub }) => (
              <button
                key={title}
                onClick={onClick}
                className={cn(
                  "group flex flex-col items-start gap-2 rounded-xl border-[1.5px] border-line bg-surface px-5 py-5 text-left",
                  "transition-all hover:-translate-y-0.5 hover:border-drop hover:bg-drop-tint/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                )}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-ink-3 transition-colors group-hover:text-drop-text">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="t-body font-semibold">{title}</span>
                <span className="t-meta text-ink-2">{sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
