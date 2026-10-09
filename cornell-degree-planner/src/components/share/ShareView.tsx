import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/LogoMark";
import { fetchShare } from "@/services/shares";
import { fetchProgram } from "@/services/programs";
import { buildBoard } from "@/lib/planner/board";
import {
  adaptCurrentShare,
  adaptLegacyShare,
  isLegacyShare,
  readLegacyShareFields,
  type ShareReadModel,
} from "@/lib/planner/legacyShare";
import { semesterLabel, formatCredits } from "@/lib/planner/semesters";
import type { ShareDoc } from "@/lib/schemas";

/**
 * ShareView (spec 005 §5) — the read-only surface behind /s/{shareId}. A frozen
 * snapshot: no drag, no actions, no auth requirement (public read). Renders its
 * own lightweight columns rather than the interactive canvas — a share is a
 * document to read, not a tool to operate.
 *
 * Spec 014: share docs are immutable, so this view reads BOTH shapes through
 * one pure read model (lib/planner/legacyShare):
 *   - new shape (schemaVersion ≥ 3) → adaptCurrentShare (placements as-is);
 *   - pre-014 slot shape → adaptLegacyShare, which needs the share's program
 *     template, fetched READ-ONLY via services/programs (one doc read, the
 *     same fetch this view made before spec 014). A missing program degrades
 *     to what the share alone can place; a failed read is the error state.
 * Read-only throughout: this view never writes anything.
 */

export function ShareView({ shareId }: { shareId: string }) {
  const [share, setShare] = useState<ShareDoc | null>(null);
  const [model, setModel] = useState<ShareReadModel | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchShare(shareId);
        if (cancelled) return;
        if (!s) {
          setState("missing");
          return;
        }
        let m: ShareReadModel;
        if (isLegacyShare(s)) {
          // The template slots aren't in an old share — read the program doc
          // (read-only). An empty programId (the blank canvas) has no doc.
          const program = s.programId ? await fetchProgram(s.programId) : null;
          if (cancelled) return;
          m = adaptLegacyShare(readLegacyShareFields(s), program?.slots ?? []);
        } else {
          m = adaptCurrentShare(s);
        }
        setShare(s);
        setModel(m);
        setState("ready");
      } catch (err) {
        console.warn("[share] load failed", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const columns = useMemo(() => {
    if (!model) return [];
    // A share renders only semesters that have content (it's a document).
    return buildBoard(model.placements, model.courses).columns.filter((c) => c.cards.length > 0);
  }, [model]);

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <p className="t-body text-ink-3">Opening the plan…</p>
      </div>
    );
  }
  if (state !== "ready" || !share || !model) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-8 text-center">
        <p className="t-headline">
          {state === "missing" ? "This plan link doesn't exist." : "We couldn't open this plan."}
        </p>
        <p className="t-body text-ink-2">
          {state === "missing"
            ? "It may have been mistyped — links are long, it happens."
            : "A connection hiccup, most likely. Try again in a moment."}
        </p>
        <a href="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 t-body font-semibold text-canvas">
          Plan your own degree <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  const completed = new Set(model.completedIds);
  const inProgress = new Set(model.inProgressIds);
  const doneCount = completed.size;
  // In progress is NOT done (spec 006 §B.1) — its own figure, never folded in.
  const inProgressCount = inProgress.size;
  // Waivers are requirement-level (spec 014) — no card carries them, so the
  // header is the one place a reader learns of them.
  const waivedCount = model.waivedRequirementIds.length;

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/* Header */}
      <div className="border-b border-line bg-surface/90">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark size={20} className="shrink-0" />
            <div className="min-w-0">
              <p className="truncate t-body font-semibold">{share.planName}</p>
              <p className="t-meta">
                {share.programName} · shared plan ·{" "}
                <span className="num">{doneCount}</span>{" "}
                {doneCount === 1 ? "course" : "courses"} completed
                {inProgressCount > 0 && (
                  <>
                    {" "}
                    · <span className="num">{inProgressCount}</span> in progress
                  </>
                )}
                {waivedCount > 0 && (
                  <>
                    {" "}
                    · <span className="num">{waivedCount}</span>{" "}
                    {waivedCount === 1 ? "requirement" : "requirements"} waived
                  </>
                )}
              </p>
            </div>
          </div>
          <a
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 t-label text-canvas transition-opacity hover:opacity-90"
          >
            Make your own plan on Coursemap <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Read-only roadmap */}
      <div className="flex-1 overflow-auto" style={{ scrollbarGutter: "stable" }}>
        <div
          className="flex min-h-full min-w-max gap-8 px-6 py-4"
          style={{
            backgroundImage: "radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {columns.map((column) => {
            const label = semesterLabel(column.sem, share.enteringYear ?? null);
            return (
              <div key={column.sem} className="flex w-[204px] shrink-0 flex-col gap-2">
                <div className="rounded-lg border border-line bg-surface/70 px-2.5 py-1.5">
                  <span className="t-label text-ink-2">{label.primary}</span>
                  <span className="ml-1.5 t-meta">{label.yearWord}</span>
                </div>
                {column.cards.map(({ placement, course }) => {
                  const isDone = completed.has(placement.id);
                  const isInProgress = inProgress.has(placement.id);
                  // A pre-014 requirement finished without naming the course
                  // (legacyShare rule 2) — no course, so it reads by requirement.
                  const bucket = model.buckets[placement.id];
                  const code = bucket ? bucket.label : `${course.subject} ${course.number}`;
                  const title = bucket ? bucket.title : course.title;
                  const credits = bucket
                    ? formatCredits(bucket.credits)
                    : formatCredits({ min: course.credits_min, max: course.credits_max });
                  return (
                    <div
                      key={placement.id}
                      className={cn(
                        "overflow-hidden rounded-lg border",
                        // Precedence per spec 006 §B.1: Complete > In progress >
                        // Available (blocked/warning aren't computed in this
                        // read-only view — no engine call here).
                        isDone
                          ? "border-complete/60 bg-complete-tint"
                          : isInProgress
                            ? "border-drop/60 bg-drop-tint"
                            : "border-line bg-surface"
                      )}
                    >
                      {(isDone || isInProgress) && (
                        <div className={cn("h-[3px] w-full", isDone ? "bg-complete" : "bg-drop")} />
                      )}
                      <div className="flex flex-col gap-0.5 px-2.5 py-2">
                        <div className="flex items-baseline justify-between gap-1.5">
                          <p className="t-label truncate">{code}</p>
                          <span className="flex shrink-0 items-center gap-1">
                            {isDone && <Check className="h-3 w-3 text-complete-text" />}
                            {credits && (
                              <span className="t-meta"><span className="num">{credits} cr</span></span>
                            )}
                          </span>
                        </div>
                        <p className={cn("line-clamp-3 t-body font-semibold", isDone && "text-complete-text")}>
                          {title}
                        </p>
                        {isInProgress && <p className="t-meta text-drop-text">In progress</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
