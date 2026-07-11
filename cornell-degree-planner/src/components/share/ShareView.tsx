import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/LogoMark";
import { fetchShare } from "@/services/shares";
import { fetchProgram } from "@/services/programs";
import { mergeEffectiveSlots } from "@/hooks/useEffectiveSlots";
import {
  groupSlotsBySemester,
  semesterLabel,
  slotCredits,
  formatCredits,
} from "@/lib/planner/semesters";
import type { ShareDoc } from "@/lib/schemas";
import type { Course, ProgramSlotWithData } from "@/types/db";

/**
 * ShareView (spec 005 §5) — the read-only surface behind /s/{shareId}. A frozen
 * snapshot: no drag, no actions, no auth requirement (public read). Renders its
 * own lightweight columns rather than the interactive canvas — a share is a
 * document to read, not a tool to operate.
 */

function snapshotToCourse(id: string, snap: unknown): Course | null {
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  return {
    id: (s.id as string) ?? id,
    subject: (s.subject as string) ?? "",
    number: (s.number as string) ?? "",
    title: (s.title as string) ?? id,
    credits_min: (s.creditsMin as number) ?? 0,
    credits_max: (s.creditsMax as number) ?? (s.creditsMin as number) ?? 0,
    description: null,
    offered: [],
    prereq_expr: null,
    coreq_expr: null,
    forbidden_overlaps: [],
    roster_id: null,
    updated_at: "",
  };
}

export function ShareView({ shareId }: { shareId: string }) {
  const [share, setShare] = useState<ShareDoc | null>(null);
  const [slots, setSlots] = useState<ProgramSlotWithData[]>([]);
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
        const program = await fetchProgram(s.programId);
        if (cancelled) return;
        setShare(s);
        setSlots(program?.slots ?? []);
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

  const groups = useMemo(() => {
    if (!share) return [];
    const { effectiveSlots } = mergeEffectiveSlots(
      slots,
      (share.slotOverrides ?? {}) as Record<string, { sem?: number; removed?: true }>,
      (share.customSlots ?? []) as { id: string; sem: number; title?: string }[]
    );
    // A share renders only semesters that have content (it's a document).
    return groupSlotsBySemester(effectiveSlots).filter((g) => g.slots.length > 0);
  }, [share, slots]);

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <p className="t-body text-ink-3">Opening the plan…</p>
      </div>
    );
  }
  if (state !== "ready" || !share) {
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

  const completed = new Set(share.completedSlotIds);
  const waived = new Set(share.waivedSlotIds);
  // Old share docs predate this field; ShareSchema defaults it to [] on parse
  // (spec 006 §B.5), so this is defensive, not load-bearing.
  const inProgress = new Set(share.inProgressSlotIds ?? []);
  const doneCount = share.completedSlotIds.length + share.waivedSlotIds.length;
  // In progress is NOT done (spec 006 §B.1) — same treatment as waived gets
  // for "done" counting, i.e. it does NOT get that treatment: it's its own
  // figure, never folded into doneCount.
  const inProgressCount = inProgress.size;

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
                {doneCount === 1 ? "requirement" : "requirements"} settled
                {inProgressCount > 0 && (
                  <>
                    {" "}
                    · <span className="num">{inProgressCount}</span> in progress
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
          {groups.map((group) => {
            const label = semesterLabel(group.sem, share.enteringYear ?? null);
            return (
              <div key={group.sem} className="flex w-[204px] shrink-0 flex-col gap-2">
                <div className="rounded-lg border border-line bg-surface/70 px-2.5 py-1.5">
                  <span className="t-label text-ink-2">
                    {label.primary}
                  </span>
                  <span className="ml-1.5 t-meta">{label.yearWord}</span>
                </div>
                {group.slots.map((slot) => {
                  const placedId = share.slotSelections[slot.id];
                  const placed = placedId
                    ? snapshotToCourse(placedId, share.courseSnapshots[placedId])
                    : null;
                  const isDone = completed.has(slot.id);
                  const isWaived = waived.has(slot.id);
                  const isInProgress = inProgress.has(slot.id);
                  const eyebrow = placed
                    ? slot.kind === "course"
                      ? `${placed.subject} ${placed.number}`
                      : (slot.elective_groups?.name ?? slot.pattern_title ?? slot.pattern ?? "Elective")
                    : slot.kind === "course" && slot.courses
                      ? `${slot.courses.subject} ${slot.courses.number}`
                      : slot.kind === "pattern"
                        ? (slot.pattern ?? "Pattern")
                        : "Elective";
                  const title = placed
                    ? placed.title
                    : slot.kind === "course" && slot.courses
                      ? slot.courses.title
                      : (slot.elective_groups?.name ?? slot.pattern_title ?? "Any course");
                  const credits = formatCredits(slotCredits(slot, placed));
                  return (
                    <div
                      key={slot.id}
                      className={cn(
                        "overflow-hidden rounded-lg border",
                        // Precedence per spec 006 §B.1: Complete > In progress >
                        // Waived > Available (blocked/warning aren't computed in
                        // this read-only view — no engine call here). In progress
                        // uses the "drop" triad as its tint pending a dedicated
                        // in-progress token from the engine/tokens work landing
                        // in parallel.
                        isDone
                          ? "border-complete/60 bg-complete-tint"
                          : isInProgress
                            ? "border-drop/60 bg-drop-tint"
                            : isWaived
                              ? "border-waived/60 bg-waived-tint"
                              : placed || (slot.kind === "course" && slot.courses)
                                ? "border-line bg-surface"
                                : "border-dashed border-line bg-transparent opacity-50"
                      )}
                    >
                      {(isDone || isInProgress || isWaived) && (
                        <div
                          className={cn(
                            "h-[3px] w-full",
                            isDone ? "bg-complete" : isInProgress ? "bg-drop" : "bg-waived"
                          )}
                        />
                      )}
                      <div className="flex flex-col gap-0.5 px-2.5 py-2">
                        <div className="flex items-baseline justify-between gap-1.5">
                          <p className="t-label truncate">{eyebrow}</p>
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
                        {isWaived && <p className="t-meta text-waived-text">Waived</p>}
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
