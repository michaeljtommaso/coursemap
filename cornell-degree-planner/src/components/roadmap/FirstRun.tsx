import { useEffect, useRef, useState } from "react";
import { RotateCw, PencilRuler, GraduationCap, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/LogoMark";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useAuth } from "@/contexts/AuthProvider";
import { EXAM_TABLES } from "@/data/credit-tables";
import { CreditsEditor } from "@/components/credits/CreditsEditor";
import {
  draftChanged,
  draftFromProfile,
  draftToEntries,
  type CreditDraft,
} from "@/components/credits/creditDraft";
import { COLLEGES, programCollegeId, programFamily, programIsVisible } from "@/lib/planner/colleges";
import { CollegePicker } from "@/components/onboarding/CollegePicker";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import {
  clearFirstRunDraft,
  loadFirstRunDraft,
  saveFirstRunDraft,
  type FirstRunDraft,
} from "@/lib/planner/firstRunDraft";
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
 * doors. "I know my major" runs the existing template flow (program grid →
 * start questions → credit step). "Still figuring it out" skips the grid
 * entirely — college → start questions → credit → a blank canvas with the
 * discovery panel already on the Majors tab, so the ranking reacts from the
 * first placed course. A faint ghost roadmap breathes behind everything: the
 * empty state previews the product.
 *
 * Spec 019 (D10/D11, Phase 2 deviation 7): the start step asks the start TERM
 * (fall or spring), and for an Arts & Sciences or CALS major also whether the
 * student transferred in and at what standing (StudentContextQuestions). The
 * blank canvas has no college, so its door asks for one (Major Match ranks
 * inside it); picking a major sets the college from the major.
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

export function FirstRun() {
  const { programs, loading, error, refetch } = usePrograms();
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const openPanel = usePlannerStore((s) => s.openPanel);
  const { uid, enteringYear, creditProfile, setCreditProfile, setStudentContext, oweToursIfNew } = useAuth();

  // Progress made so far in this browser (see lib/planner/firstRunDraft.ts): a
  // reload resumes at the same step. Only read here, in first run — a student
  // who already has a program never reaches this component.
  const [resumed] = useState<FirstRunDraft | null>(() => loadFirstRunDraft(uid));
  // The uid the draft was last read for (a late-arriving uid reads it once).
  const [hydratedUid, setHydratedUid] = useState<string | null>(uid ?? null);
  // Set once the flow is over, so a late state change can't save it again.
  const finished = useRef(false);

  // Which door the student chose (spec 011 §3). null = the two-doors screen is
  // showing. "known" reveals the majors grid; "discover" heads straight into the
  // college/start/credit steps toward the blank canvas.
  const [door, setDoor] = useState<"known" | "discover" | null>(resumed?.door ?? null);
  const discovering = door === "discover";

  // The pending program is held by id so it can be restored before the
  // program list has loaded; the Program object is resolved below.
  const [pendingProgramId, setPendingProgramId] = useState<string | null>(resumed?.programId ?? null);
  // Steps once a program is pending. "college": the discovery door's college
  // question. "questions": start term (+ transfer questions for Arts & Sciences
  // / CALS) — StudentContextQuestions saves the answers itself. "credits"
  // (spec 007 §2b/§5b, Unit 7C2): "Arriving with AP/IB credit?" Skippable, and
  // only shown on the brand-new-user path (pendingProgram is only ever set
  // there); a returning user (enteringYear already known) still goes straight
  // to the roadmap via the fast path below, unchanged — the Requirements panel
  // asks inline later if its engine needs an answer.
  const [step, setStep] = useState<"college" | "questions" | "credits">(resumed?.step ?? "questions");
  // The credit step's draft (spec 028: the shared CreditsEditor). Seeded from
  // any credit already saved, so finishing first run never drops it.
  const [creditDraft, setCreditDraft] = useState<CreditDraft>(
    () => resumed?.creditDraft ?? draftFromProfile(creditProfile, EXAM_TABLES)
  );
  // Save state for the credit write (SignInDialog's idle|loading|error idiom):
  // a failed write must NOT strand onboarding — surface a quiet inline error
  // and keep both "Skip for now" and retry one click away.
  const [creditStatus, setCreditStatus] = useState<"idle" | "saving" | "error">("idle");

  // A uid that arrives after the first render: read its saved progress once,
  // as long as the student hasn't started choosing yet. (Adjusting state while
  // rendering, keyed on the uid, rather than in an effect.)
  if (uid && hydratedUid !== uid) {
    setHydratedUid(uid);
    const saved = door === null && pendingProgramId === null && resumed === null ? loadFirstRunDraft(uid) : null;
    if (saved) {
      setDoor(saved.door);
      setPendingProgramId(saved.programId);
      setStep(saved.step);
      if (saved.creditDraft) setCreditDraft(saved.creditDraft);
    }
  }

  // The blank canvas is a real program too — prefer its seeded doc, fall back to
  // the synthetic one so the discovery door works pre-seed (spec 006 §F5).
  const blankProgram = programs.find((p) => p.id === BLANK_ID) ?? SYNTHETIC_BLANK;
  const pendingProgram: Program | null = pendingProgramId
    ? pendingProgramId === BLANK_ID
      ? blankProgram
      : (programs.find((p) => p.id === pendingProgramId) ?? null)
    : null;
  const setPendingProgram = (p: Program | null) => setPendingProgramId(p?.id ?? null);
  // Keep "blank" out of the majors pill grid — the discovery door owns it now.
  // Hidden majors (spec 019 D11) aren't offered to someone choosing a major.
  const majorPrograms = programs.filter((p) => p.id !== BLANK_ID && programIsVisible(p));
  // Grouped by college once the grid spans more than one (Engineering, Arts &
  // Sciences, CALS); programs with no known college go last.
  const majorGroups = [
    ...COLLEGES.map((c) => ({
      key: c.id,
      label: c.name,
      programs: majorPrograms.filter((p) => programCollegeId(p) === c.id),
    })),
    { key: "other", label: "Other", programs: majorPrograms.filter((p) => programCollegeId(p) === null) },
  ].filter((g) => g.programs.length > 0);

  const commit = (program: Program) => {
    // First run is over: drop the saved progress before the program (and so the
    // plan) is created, so it can never be resumed into a second plan.
    finished.current = true;
    clearFirstRunDraft(uid);
    // The picked major's college is the student's (spec 019 D11). The blank
    // canvas has none — its door asked (CollegePicker) instead.
    const college = programCollegeId(program);
    if (college) void setStudentContext({ college });
    // A student finishing first run is owed the tours (spec 039 D5). The
    // provider waits for the profile (first run can finish before it loads)
    // and only marks them when none are recorded, so a returning student never
    // gets them again.
    void oweToursIfNew();
    // The discovery door lands on the blank canvas with the ranking already in
    // view (spec 011 §3) — open the panel on the Majors tab so the first placed
    // course visibly moves the list.
    if (discovering) openPanel("majors");
    setSelectedProgramId(program.id);
  };

  const pickProgram = (program: Program) => {
    // Already know their year (returning user)? Straight to the roadmap.
    if (enteringYear) commit(program);
    else {
      setPendingProgram(program);
      setStep("questions");
    }
  };

  /** Door 1 — "I know my major": reveal the existing program grid. */
  const chooseKnown = () => setDoor("known");

  /** Door 2 — "Still figuring it out": no program pick — ask the college, then
   *  head into the start/credit steps toward the blank canvas. */
  const chooseDiscover = () => {
    setDoor("discover");
    setPendingProgram(blankProgram);
    setStep("college");
  };

  /** College step resolved (picked or skipped). A returning user (year known)
   *  skips straight to the credit step, which is skippable either way. */
  const afterCollege = () => (enteringYear ? advanceToCredits() : setStep("questions"));

  /** Back to the two-doors screen (from the grid or the first step). */
  const backToDoors = () => {
    clearFirstRunDraft(uid);
    setDoor(null);
    setPendingProgram(null);
    setStep("questions");
  };

  /** Start questions resolved (answered or skipped) — advance to the credit
   *  step rather than committing immediately. The editor starts from whatever
   *  credit is already saved (a returning guest's, say). */
  const advanceToCredits = () => {
    setCreditDraft(draftFromProfile(creditProfile, EXAM_TABLES));
    setStep("credits");
  };

  /** Credit step resolved (saved or skipped) — commit and land on the roadmap.
   *  A failed save stays on the step with an inline error (selections intact);
   *  "Skip for now" always works, so onboarding can never be stranded. */
  const finishCredits = async (save: boolean) => {
    if (!pendingProgram || creditStatus === "saving") return;
    if (save && draftChanged(creditDraft, creditProfile, EXAM_TABLES)) {
      setCreditStatus("saving");
      const entries = draftToEntries(creditDraft, EXAM_TABLES);
      try {
        await setCreditProfile(entries);
      } catch (err) {
        console.warn("[first-run] setCreditProfile failed", err);
        setCreditStatus("error");
        return;
      }
    }
    setCreditStatus("idle");
    commit(pendingProgram);
    setPendingProgram(null);
    setStep("questions");
  };

  // Save progress as the student goes. Only writes (clearing is explicit, at
  // the two ways out of the flow), and not before the uid's draft was read, so
  // an empty first render can never overwrite saved progress.
  useEffect(() => {
    if (!uid || hydratedUid !== uid || finished.current) return;
    if (door === null && pendingProgramId === null) return;
    saveFirstRunDraft(uid, {
      door,
      programId: pendingProgramId,
      step,
      creditDraft: pendingProgramId && step === "credits" ? creditDraft : null,
    });
  }, [uid, hydratedUid, door, pendingProgramId, step, creditDraft]);

  // Render phase. The discovery door always sets pendingProgram (→ college/
  // start/credit steps), so an unset pendingProgram means either the majors
  // grid ("known" door) or the two-doors screen (no door yet).
  const collegeStep = !!pendingProgram && step === "college";
  const creditStep = !!pendingProgram && step === "credits";
  const questionsStep = !!pendingProgram && step === "questions";
  const majorsGrid = !pendingProgram && door === "known";
  const doorsScreen = !pendingProgram && door === null;
  // The college/start/credit steps label the pending choice — the blank
  // program reads as the discovery intent, not "Blank".
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

        {/* Heading — adapts to the phase (the college/start/credit steps carry
            their own centered prompt, so no big heading there). */}
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
          <div className="flex w-full max-w-2xl flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="t-label">{stepLabel}</p>
              <h2 className="t-headline">Your AP, IB and transfer credit</h2>
              <p className="t-body text-ink-2">
                Arriving with exam or transfer credit? Add it now and your board starts
                past the classes you&apos;ve already covered.
              </p>
            </div>
            <div className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-left">
              <CreditsEditor
                draft={creditDraft}
                onChange={setCreditDraft}
                major={
                  pendingProgram && pendingProgram.id !== BLANK_ID
                    ? { name: pendingProgram.name, shortName: pendingProgram.short_name ?? undefined }
                    : null
                }
                listClassName="max-h-[36vh]"
              />
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
        ) : collegeStep ? (
          /* College step — the discovery door only: the blank canvas has no
             college, and Major Match ranks inside one (spec 019 D3/D11). */
          <div className="flex flex-col items-center gap-4">
            <p className="t-label">{stepLabel}</p>
            <CollegePicker onDone={afterCollege} />
            <div className="flex items-center gap-3">
              <button
                onClick={afterCollege}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                I&apos;ll pick this later
              </button>
              <button
                onClick={backToDoors}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                Back
              </button>
            </div>
          </div>
        ) : questionsStep && pendingProgram ? (
          /* Start step (both doors): start term, plus the transfer questions
             for an Arts & Sciences / CALS major. Answers save when the last
             one is picked; skipping saves nothing. */
          <div className="flex flex-col items-center gap-4">
            <p className="t-label">{stepLabel}</p>
            <StudentContextQuestions
              key={pendingProgram.id}
              family={programFamily(pendingProgram)}
              programId={pendingProgram.id}
              onDone={advanceToCredits}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={advanceToCredits}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                I&apos;ll add this later
              </button>
              <button
                onClick={() => (discovering ? setStep("college") : setPendingProgram(null))}
                className="t-meta text-ink-3 underline-offset-2 hover:underline"
              >
                Back
              </button>
            </div>
          </div>
        ) : majorsGrid ? (
          /* "I know my major" door — program pills (13 CoE majors) + blank card */
          <div className="flex w-full max-w-3xl flex-col gap-3">
            {loading ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-[76px] animate-pulse rounded-xl border border-line bg-surface-2/60"
                    aria-hidden="true"
                  />
                ))}
              </div>
            ) : (
              majorGroups.map((g) => (
                <div key={g.key} className="flex flex-col gap-2">
                  {majorGroups.length > 1 && <p className="t-label">{g.label}</p>}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {g.programs.map((p) => (
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
                </div>
              ))
            )}

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
