import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { useProgramStore } from "@/store/useProgramStore";
import { useProgramContext } from "@/contexts/ProgramProvider";
import {
  subscribePlan,
  createPlan,
  updatePlan,
  deletePlan as deletePlanDoc,
  listPlans,
  type PlanListItem,
} from "@/services/plans";
import type { NormalizedPlan } from "@/lib/normalize/normalizePlan";
import type { SlotOverride, CustomSlot } from "@/lib/schemas";
import type { Course, ProgramSlotWithData } from "@/types/db";
import { usePlannerStore } from "@/store/usePlannerStore";
import { buildReplacePlan, type ReplacePlan } from "@/lib/planner/replaceUndo";
import {
  remapPlacements,
  type RemapPlacement,
  type RemapTargetSlot,
  type RemapMark,
} from "@/lib/planner/remapPlacements";
import {
  seedPlanFromPrevious,
  planContentIsEmpty,
  type OldProgramSlot,
} from "@/lib/planner/seedPlanFromPrevious";

/**
 * PlanProvider (docs/specs/002 §6) — owns the authoritative cloud plan and all
 * plan mutations, replacing the plan-data half of usePlannerStore.
 *
 * Sync recipe (standard layout-persistence): self-write, 600ms debounce,
 * echo-suppress, sanitize-on-load.
 *   - onSnapshot(users/{uid}/plans/{activePlanId}) is the source of truth.
 *   - Mutations apply OPTIMISTICALLY to a local overlay and write through
 *     updatePlan() debounced 600ms.
 *   - lastWrittenRef holds a signature of our own last write; the snapshot that
 *     round-trips it is ignored (echo suppression).
 *   - sanitize-on-load drops slotSelections whose slotId isn't in the current
 *     program doc, and courseSnapshots no longer referenced by any selection.
 *
 * Auto-create: a fresh user with no active plan who picks a program gets a plan
 * auto-created (name defaulted to the program shortName).
 *
 * Exposes the SAME mutation names/signatures the old store did (assignSlot,
 * clearSlot, toggleCompleted, toggleWaived, resetPlan) so GridSlotNode /
 * DragGhost / CourseCatalog / RoadmapCanvas call sites change minimally.
 */

const DEBOUNCE_MS = 600;

// The in-memory plan state the UI reads. slotSelections/completed/waived mirror
// the plan doc; selectedCourses is the Course[] projection of courseSnapshots
// (the UI renders Course objects, not raw snapshots).
type PlanState = {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  /** "Currently taking" (spec 006 §B.1) — additive, mirrors waivedSlotIds. */
  inProgressSlotIds: string[];
  selectedCourses: Record<string, Course>;
  // v2 mutability (spec 005 §9)
  slotOverrides: Record<string, SlotOverride>;
  customSlots: CustomSlot[];
};

type PlanContextValue = PlanState & {
  planId: string | null;
  planName: string | null;
  planLoading: boolean;
  planError: boolean;
  assignSlot: (slotId: string, course: Course) => void;
  clearSlot: (slotId: string) => void;
  toggleCompleted: (slotId: string) => void;
  toggleWaived: (slotId: string) => void;
  /** Toggle "currently taking" (spec 006 §B.1). Mirrors toggleWaived; marking
   *  in-progress clears complete + waived (one manual state per slot). */
  toggleInProgress: (slotId: string) => void;
  resetPlan: () => void;
  /** Rename the active plan (spec 004 §"intimate": the plan has a name). */
  renamePlan: (name: string) => void;
  // ── Roadmap mutability (spec 005 §9) ──
  /** Move a slot (template or custom) to another semester. */
  moveSlot: (slotId: string, sem: number) => void;
  /** Remove a slot from the graph (template → override; custom → delete). */
  removeSlot: (slotId: string) => void;
  /** Bring a removed template slot back. */
  restoreSlot: (slotId: string) => void;
  /** Add a generic "any course" slot to a semester; returns its id. */
  addCustomSlot: (sem: number, title?: string) => string;
  // ── Plan switcher (spec 005 §6, multiple plans per program) ──
  plansList: PlanListItem[];
  switchPlan: (planId: string, programId: string) => Promise<void>;
  createNewPlan: (programId: string, name: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const EMPTY: PlanState = {
  slotSelections: {},
  completedSlotIds: [],
  waivedSlotIds: [],
  inProgressSlotIds: [],
  selectedCourses: {},
  slotOverrides: {},
  customSlots: [],
};

// courseSnapshots (camelCase display cache) → Course (snake_case app type).
function snapshotToCourse(id: string, snap: unknown): Course {
  const s = (snap ?? {}) as Record<string, unknown>;
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
    prereq_notes: [],
    attrs: [],
    sections: [],
    components: [],
    roster_id: null,
    roster: null,
    updated_at: new Date(0).toISOString(),
  };
}

function courseToSnapshot(c: Course) {
  return {
    id: c.id,
    subject: c.subject,
    number: c.number,
    title: c.title,
    creditsMin: c.credits_min,
    creditsMax: c.credits_max,
  };
}

// A program slot as the C4 re-mapper needs it (spec 009 §4). Elective slots
// carry their qualifying rule; course/pattern/attribute carry their matcher.
function toRemapTarget(s: ProgramSlotWithData): RemapTargetSlot {
  return {
    id: s.id,
    kind: s.kind,
    courseId: s.courses?.id ?? s.course_id,
    pattern: s.pattern,
    attributeMatch: s.attribute_match ?? null,
    qualifyingRule: s.elective_groups?.qualifying_rule ?? null,
  };
}

// Stable signature of the writable plan fields, for echo suppression.
function planSignature(p: {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  inProgressSlotIds: string[];
  courseSnapshots: Record<string, unknown>;
  slotOverrides: Record<string, SlotOverride>;
  customSlots: CustomSlot[];
}): string {
  return JSON.stringify({
    s: Object.keys(p.slotSelections)
      .sort()
      .map((k) => [k, p.slotSelections[k]]),
    c: [...p.completedSlotIds].sort(),
    w: [...p.waivedSlotIds].sort(),
    ip: [...p.inProgressSlotIds].sort(),
    cs: Object.keys(p.courseSnapshots).sort(),
    o: Object.keys(p.slotOverrides)
      .sort()
      .map((k) => [k, p.slotOverrides[k]?.sem ?? null, p.slotOverrides[k]?.removed ?? false]),
    cu: [...p.customSlots]
      .map((c) => [c.id, c.sem, c.title ?? ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { uid, profile, loading: authLoading, setActivePlanId } = useAuth();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs, getProgramData, loadProgramData } = useProgramContext();
  // Toast surface (spec 009 §2/§4) — the replace/undo affordance and the C4
  // program-switch summary. Zustand actions are stable, so selecting them here
  // does not re-render the provider.
  const showToast = usePlannerStore((s) => s.showToast);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>(EMPTY);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(false);
  const [plansList, setPlansList] = useState<PlanListItem[]>([]);
  // Bumped after create/delete to force the resolution effect to re-run.
  const [resolveKey, setResolveKey] = useState(0);

  // Mirror of `state` for synchronous reads inside mutations — capturing the
  // incumbent (and the incoming course's prior slot) BEFORE a replace, without
  // threading `state` through mutation deps.
  const stateRef = useRef<PlanState>(EMPTY);
  // C4 re-map summary toast: show once per plan load that actually re-mapped.
  const remapNoticeRef = useRef<string | null>(null);
  // ── C4 cross-plan carry-over (spec 009 §4, per-program-plan architecture) ──
  // A real major switch swaps plan DOCUMENTS. At switch time we capture the
  // outgoing plan's state + its program's slots as the seed source; if the
  // target program's plan turns out MISSING/EMPTY, applyLoadedPlan seeds it.
  const pendingSeedRef = useRef<{
    toProgramId: string;
    prevState: PlanState;
    oldProgramSlots: OldProgramSlot[];
    /** Full Course objects of the old program's fixed template slots, for the
     *  snapshot/selectedCourses carry when a MARKED template course travels. */
    templateCourses: Record<string, Course>;
  } | null>(null);
  // The program the currently-loaded state belongs to (last resolved program).
  const lastProgramIdRef = useRef<string | null>(null);
  // Plan id we just seeded: a stale EMPTY snapshot (emitted before the seed's
  // debounced write lands) must not wipe the seeded optimistic state.
  const seededPlanRef = useRef<string | null>(null);
  // Fresh view of the program list for the C4 summary (short name), read at
  // snapshot time without adding churn to applyLoadedPlan's deps.
  const programsRef = useRef(programs);
  useEffect(() => {
    programsRef.current = programs;
  }, [programs]);

  // Mutable plan-doc fields we hold for writing (courseSnapshots isn't projected
  // into `state` as-is — we keep the raw map here so writes are lossless).
  const snapshotsRef = useRef<Record<string, unknown>>({});
  // Echo suppression: signature of our own last write; the snapshot matching it
  // is skipped. Also suppress the very first optimistic->write round-trip.
  const lastWrittenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending (un-flushed) debounced write, captured so a plan switch / unmount can
  // flush it immediately instead of dropping the mutation.
  const pendingWriteRef = useRef<{
    uid: string;
    planId: string;
    payload: {
      slotSelections: Record<string, string>;
      completedSlotIds: string[];
      waivedSlotIds: string[];
      inProgressSlotIds: string[];
      courseSnapshots: Record<string, unknown>;
      slotOverrides: Record<string, SlotOverride>;
      customSlots: CustomSlot[];
      schemaVersion: number;
    };
  } | null>(null);
  const planIdRef = useRef<string | null>(null);
  const uidRef = useRef<string | null>(null);
  // Guard so we only auto-create one plan per (uid, program) resolution pass.
  const creatingRef = useRef(false);

  useEffect(() => {
    planIdRef.current = planId;
  }, [planId]);
  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Resolve which plan is active for the selected program ──────────────────
  // Order: profile.activePlanId (if it's for this program) → an existing plan for
  // this program → auto-create (name = program shortName). Runs when uid/profile/
  // selectedProgramId settle.
  useEffect(() => {
    if (authLoading || !uid || !profile) return;
    if (!selectedProgramId || selectedProgramId.startsWith("custom-")) {
      // No real program selected — clear the active plan view (and any pending
      // carry-over: with the state cleared there is no source to seed from).
      setPlanId(null);
      setState(EMPTY);
      snapshotsRef.current = {};
      lastProgramIdRef.current = null;
      pendingSeedRef.current = null;
      return;
    }
    // C4 cross-plan carry-over capture (spec 009 §4): on a REAL program switch,
    // grab the outgoing plan's state NOW — synchronously, before the plan
    // subscription swaps docs and clears it — plus the old program's slots
    // (for effective-semester resolution AND so a MARKED template course can
    // travel: the mark is student-asserted truth). Consumed by applyLoadedPlan
    // only if the target program's plan turns out missing/empty; a re-run of
    // this effect for the SAME program (StrictMode, programs load, resolveKey)
    // captures nothing and leaves a pending seed intact.
    if (lastProgramIdRef.current && lastProgramIdRef.current !== selectedProgramId) {
      const oldSlots = getProgramData(lastProgramIdRef.current)?.slots ?? [];
      const templateCourses: Record<string, Course> = {};
      for (const s of oldSlots) {
        if (s.kind === "course" && s.courses) templateCourses[s.courses.id] = s.courses;
      }
      pendingSeedRef.current = {
        toProgramId: selectedProgramId,
        prevState: stateRef.current,
        oldProgramSlots: oldSlots.map((s) => ({
          id: s.id,
          suggested_semester: s.suggested_semester,
          course: s.kind === "course" && s.courses ? s.courses : null,
        })),
        templateCourses,
      };
    }
    lastProgramIdRef.current = selectedProgramId;

    let cancelled = false;
    (async () => {
      try {
        const existing = await listPlans(uid);
        if (cancelled) return;
        setPlansList(existing);

        // A pending seed needs the TARGET program's slots cached before the
        // plan snapshot arrives (applyLoadedPlan reads the cache synchronously
        // to re-map). Await it here so the seeding can't miss its window.
        if (pendingSeedRef.current?.toProgramId === selectedProgramId) {
          await loadProgramData(selectedProgramId).catch(() => null);
          if (cancelled) return;
        }

        // Prefer the profile's active plan if it targets this program.
        const active = profile.activePlanId
          ? existing.find(
              (p) => p.id === profile.activePlanId && p.programId === selectedProgramId
            )
          : undefined;
        const forProgram =
          active ?? existing.find((p) => p.programId === selectedProgramId);

        if (forProgram) {
          setPlanId(forProgram.id);
          if (profile.activePlanId !== forProgram.id) {
            await setActivePlanId(forProgram.id);
          }
          return;
        }

        // Auto-create needs the program list (for the shortName). If it hasn't
        // loaded yet, bail this pass — the effect re-runs when `programs`
        // populates. Serialize creates with creatingRef so a StrictMode
        // double-invoke or a fast re-render can't create two plans at once.
        const prog = programs.find((p) => p.id === selectedProgramId);
        if (!prog) return;
        if (creatingRef.current) return;
        creatingRef.current = true;

        const name = prog.short_name || prog.name || "My Plan";
        const newId = crypto.randomUUID();
        // Suppress the create's echo (initial empty doc).
        lastWrittenRef.current = planSignature({
          slotSelections: {},
          completedSlotIds: [],
          waivedSlotIds: [],
          inProgressSlotIds: [],
          courseSnapshots: {},
          slotOverrides: {},
          customSlots: [],
        });
        try {
          await createPlan(uid, newId, { name, programId: selectedProgramId });
          if (cancelled) return;
          setPlanId(newId);
          await setActivePlanId(newId);
        } finally {
          creatingRef.current = false;
        }
      } catch (err) {
        console.warn("[plan] resolve/auto-create failed", err);
        if (!cancelled) setPlanError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // profile.activePlanId intentionally excluded — we write it ourselves and
    // don't want that write to retrigger resolution. uid + program are the keys;
    // resolveKey forces a pass after create/delete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authLoading, selectedProgramId, programs, resolveKey]);

  // ── Subscribe to the active plan doc ───────────────────────────────────────
  useEffect(() => {
    if (!uid || !planId) return;
    setPlanLoading(true);
    setPlanError(false);
    // New plan focus: clear the previous plan's overlay + echo signature so its
    // data can't bleed into this plan's view (the first snapshot repopulates).
    setState(EMPTY);
    setPlanName(null);
    snapshotsRef.current = {};
    lastWrittenRef.current = null;
    remapNoticeRef.current = null; // allow the C4 summary again for this plan

    // Program doc slot IDs for sanitize-on-load (may be empty until loaded — in
    // that case we don't prune, to avoid dropping valid selections prematurely).
    const unsub = subscribePlan(uid, planId, ({ plan, error }) => {
      setPlanLoading(false);
      if (error) {
        setPlanError(true);
        return;
      }
      if (!plan) {
        // Doc doesn't exist yet (create in flight) — keep current optimistic view.
        return;
      }
      // Post-seed guard (spec 009 §4): after seeding this plan's initial state
      // from the previous program, a stale EMPTY snapshot — emitted before the
      // seed's debounced write lands — must not wipe the seeded optimistic view.
      if (seededPlanRef.current === planId && planContentIsEmpty(plan)) {
        return;
      }

      const sig = planSignature({
        slotSelections: plan.slotSelections,
        completedSlotIds: plan.completedSlotIds,
        waivedSlotIds: plan.waivedSlotIds,
        inProgressSlotIds: plan.inProgressSlotIds,
        courseSnapshots: plan.courseSnapshots,
        slotOverrides: plan.slotOverrides,
        customSlots: plan.customSlots,
      });
      // Name updates apply even on echo-suppressed snapshots (renames write
      // outside the debounced payload, so the signature doesn't cover them).
      setPlanName(plan.name ?? null);

      // Echo suppression: ignore the snapshot that round-trips our own write.
      if (lastWrittenRef.current !== null && sig === lastWrittenRef.current) {
        return;
      }

      applyLoadedPlan(plan);
    });

    return () => {
      // Flush (not drop) any pending write for the plan we're leaving BEFORE
      // detaching the listener, so a fast switch can't lose a mutation.
      flushPendingWrite();
      unsub();
    };
    // applyLoadedPlan + flushPendingWrite are stable useCallbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, planId]);

  // ── Debounced write-through ────────────────────────────────────────────────
  // (Defined before applyLoadedPlan, which schedules the C4 seed write.)
  // Flush the pending write NOW (used by the debounce timer and on plan switch /
  // unmount so an in-flight mutation is never dropped).
  const flushPendingWrite = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingWriteRef.current;
    if (!pending) return;
    pendingWriteRef.current = null;
    // Defensive strip: Firestore rejects ANY undefined value in a payload and
    // fails the whole write. JSON round-trip drops undefined fields (the
    // payload is plain data — no timestamps/sentinels at this layer).
    pending.payload = JSON.parse(JSON.stringify(pending.payload));
    // Record the signature so the resulting snapshot is echo-suppressed.
    lastWrittenRef.current = planSignature(pending.payload);
    updatePlan(pending.uid, pending.planId, pending.payload).catch((err) => {
      console.warn("[plan] write failed", err);
      setPlanError(true);
    });
  }, []);

  const scheduleWrite = useCallback(
    (next: PlanState) => {
      const uidNow = uidRef.current;
      const planIdNow = planIdRef.current;
      if (!uidNow || !planIdNow) return;

      pendingWriteRef.current = {
        uid: uidNow,
        planId: planIdNow,
        payload: {
          slotSelections: next.slotSelections,
          completedSlotIds: next.completedSlotIds,
          waivedSlotIds: next.waivedSlotIds,
          inProgressSlotIds: next.inProgressSlotIds,
          courseSnapshots: snapshotsRef.current,
          slotOverrides: next.slotOverrides,
          customSlots: next.customSlots,
          schemaVersion: 2, // any write upgrades a v1 doc to v2
        },
      };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushPendingWrite, DEBOUNCE_MS);
    },
    [flushPendingWrite]
  );

  // The currently selected program's full slots, or null if not loaded. Read
  // lazily so we don't tie the subscription to program-data load ordering.
  const getCurrentProgram = useCallback((): {
    pid: string;
    slots: ProgramSlotWithData[];
  } | null => {
    const pid = useProgramStore.getState().selectedProgramId;
    if (!pid) return null;
    const data = getProgramData(pid);
    if (!data) return null;
    return { pid, slots: data.slots };
  }, [getProgramData]);

  // Sanitize-on-load + project courseSnapshots → selectedCourses. Spec 009 §4
  // (C4): a selection whose slot id is GONE from the (re-seeded) program is NO
  // LONGER dropped — it is re-mapped into a compatible slot or a fresh custom
  // slot so placements always survive.
  const applyLoadedPlan = useCallback(
    (plan: NormalizedPlan) => {
      // ── C4 cross-plan seeding (spec 009 §4): a major switch lands on the new
      //    program's OWN plan doc. If that plan is MISSING/EMPTY and a
      //    carry-over seed is pending, its initial state is the previous plan's
      //    placements re-mapped into this program. Consumed at most once per
      //    switch, whatever the outcome; a NON-empty plan loads untouched (the
      //    user's prior work on that major) with no seeding and no toast. The
      //    OLD plan document is never modified by this. ──
      const pendingSeed = pendingSeedRef.current;
      if (pendingSeed && pendingSeed.toProgramId === plan.programId) {
        pendingSeedRef.current = null;
        if (planContentIsEmpty(plan)) {
          const target = getCurrentProgram();
          if (target && target.pid === plan.programId) {
            const seed = seedPlanFromPrevious(
              pendingSeed.prevState,
              pendingSeed.oldProgramSlots,
              target.slots.map(toRemapTarget)
            );
            if (seed) {
              // Carry course objects + snapshots for exactly the seeded
              // selections: user placements from the old plan's selectedCourses,
              // marked template courses from the captured template map.
              const selectedCourses: Record<string, Course> = {};
              const courseSnapshots: Record<string, unknown> = {};
              for (const cid of seed.courseIds) {
                const c =
                  pendingSeed.prevState.selectedCourses[cid] ??
                  pendingSeed.templateCourses[cid];
                if (!c) continue;
                selectedCourses[cid] = c;
                courseSnapshots[cid] = courseToSnapshot(c);
              }
              snapshotsRef.current = courseSnapshots;
              const next: PlanState = {
                slotSelections: seed.slotSelections,
                completedSlotIds: seed.completedSlotIds,
                waivedSlotIds: seed.waivedSlotIds,
                inProgressSlotIds: seed.inProgressSlotIds,
                selectedCourses,
                slotOverrides: {},
                customSlots: seed.customSlots,
              };
              setState(next);
              // Persist through the NORMAL debounced save — planIdRef already
              // points at the NEW plan doc, so only that doc is written.
              scheduleWrite(next);
              seededPlanRef.current = planIdRef.current;
              const shortName =
                programsRef.current.find((p) => p.id === plan.programId)?.short_name ??
                "the new major";
              const keptPhrase =
                seed.kept === 1 ? "Kept your course" : `Kept your ${seed.kept} courses`;
              showToast(
                seed.matched > 0
                  ? `${keptPhrase} — ${seed.matched} matched ${shortName} requirements`
                  : `${keptPhrase} in new slots`
              );
              return;
            }
          }
        }
      }

      const current = getCurrentProgram();
      const programSlotIds = current ? new Set(current.slots.map((s) => s.id)) : null;
      const validSlot = (slotId: string) =>
        programSlotIds === null ? true : programSlotIds.has(slotId);

      // Custom slots first: their ids are valid selection/completion targets too.
      const seenCustomIds = new Set<string>();
      const customSlots: CustomSlot[] = [];
      for (const c of plan.customSlots) {
        if (!c?.id || seenCustomIds.has(c.id)) continue;
        seenCustomIds.add(c.id);
        customSlots.push({
          id: c.id,
          sem: Math.min(10, Math.max(1, c.sem ?? 1)),
          title: c.title,
        });
      }
      const validSlotOrCustom = (slotId: string) =>
        seenCustomIds.has(slotId) || validSlot(slotId);

      // Split selections into those that stayed valid and orphans (slot gone).
      const slotSelections: Record<string, string> = {};
      const orphans: { slotId: string; courseId: string }[] = [];
      for (const [slotId, courseId] of Object.entries(plan.slotSelections)) {
        if (validSlotOrCustom(slotId)) slotSelections[slotId] = courseId;
        else orphans.push({ slotId, courseId });
      }

      const completedSet = new Set(plan.completedSlotIds.filter(validSlotOrCustom));
      const waivedSet = new Set(plan.waivedSlotIds.filter(validSlotOrCustom));
      const inProgressSet = new Set(plan.inProgressSlotIds.filter(validSlotOrCustom));

      // ── C4 re-map (only when THIS plan's program is loaded — never remap into
      //    a different program's slots, which would corrupt the doc). ──
      let remapSummary: { kept: number; matched: number } | null = null;
      if (current && current.pid === plan.programId && orphans.length > 0) {
        const targetSlots: RemapTargetSlot[] = current.slots.map(toRemapTarget);
        const occupied = new Set<string>(Object.keys(slotSelections));

        const placements: RemapPlacement[] = [];
        for (const { slotId, courseId } of orphans) {
          const snap = plan.courseSnapshots[courseId];
          if (!snap) continue; // no course data to carry — cannot re-map
          const c = snapshotToCourse(courseId, snap);
          const mark: RemapMark | null = plan.completedSlotIds.includes(slotId)
            ? "completed"
            : plan.waivedSlotIds.includes(slotId)
              ? "waived"
              : plan.inProgressSlotIds.includes(slotId)
                ? "in-progress"
                : null;
          const sem = Math.min(10, Math.max(1, plan.slotOverrides[slotId]?.sem ?? 1));
          placements.push({
            slotId,
            course: { id: c.id, subject: c.subject, number: c.number, title: c.title, attrs: c.attrs },
            semester: sem,
            mark,
          });
        }

        if (placements.length > 0) {
          const result = remapPlacements(placements, targetSlots, occupied);
          for (const m of result.moves) slotSelections[m.toSlotId] = m.courseId;
          for (const cc of result.customCreations) {
            slotSelections[cc.slotId] = cc.courseId;
            customSlots.push({ id: cc.slotId, sem: cc.sem });
            seenCustomIds.add(cc.slotId);
          }
          for (const t of result.markTransfers) {
            if (t.mark === "completed") completedSet.add(t.toSlotId);
            else if (t.mark === "waived") waivedSet.add(t.toSlotId);
            else inProgressSet.add(t.toSlotId);
          }
          remapSummary = { kept: result.keptCount, matched: result.matchedCount };
        }
      }

      const completedSlotIds = [...completedSet];
      const waivedSlotIds = [...waivedSet];
      const inProgressSlotIds = [...inProgressSet];

      // Overrides apply to TEMPLATE slots only; prune unknown/custom keys and
      // drop entries that no longer say anything.
      const slotOverrides: Record<string, SlotOverride> = {};
      for (const [slotId, o] of Object.entries(plan.slotOverrides)) {
        if (!validSlot(slotId) || seenCustomIds.has(slotId)) continue;
        const clean: SlotOverride = {};
        if (o?.sem != null) clean.sem = Math.min(10, Math.max(1, o.sem));
        if (o?.removed === true) clean.removed = true;
        if (clean.sem != null || clean.removed) slotOverrides[slotId] = clean;
      }

      // Drop courseSnapshots no longer referenced by any surviving selection.
      const referenced = new Set(Object.values(slotSelections));
      const courseSnapshots: Record<string, unknown> = {};
      for (const [courseId, snap] of Object.entries(plan.courseSnapshots)) {
        if (referenced.has(courseId)) courseSnapshots[courseId] = snap;
      }
      snapshotsRef.current = courseSnapshots;

      const selectedCourses: Record<string, Course> = {};
      for (const [courseId, snap] of Object.entries(courseSnapshots)) {
        selectedCourses[courseId] = snapshotToCourse(courseId, snap);
      }

      setState({
        slotSelections,
        completedSlotIds,
        waivedSlotIds,
        inProgressSlotIds,
        selectedCourses,
        slotOverrides,
        customSlots,
      });

      // C4 summary toast — once per plan load that re-mapped (no action button).
      if (remapSummary && remapNoticeRef.current !== planIdRef.current) {
        remapNoticeRef.current = planIdRef.current;
        const shortName =
          programsRef.current.find((p) => p.id === current?.pid)?.short_name ?? "the new major";
        const { kept, matched } = remapSummary;
        const keptPhrase = kept === 1 ? "Kept your course" : `Kept your ${kept} courses`;
        showToast(
          matched > 0
            ? `${keptPhrase} — ${matched} matched ${shortName} requirements`
            : `${keptPhrase} in new slots`
        );
      }
    },
    [getCurrentProgram, showToast, scheduleWrite]
  );

  // ── Mutations (optimistic overlay + debounced write) ───────────────────────
  const commit = useCallback(
    (updater: (s: PlanState) => PlanState) => {
      setState((prev) => {
        const next = updater(prev);
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite]
  );

  // Undo a replace (spec 009 §2) — restore the exact prior selections for the
  // slots the assignment touched, re-adding the displaced incumbent's Course +
  // snapshot so it survives even if it went momentarily unreferenced.
  const restorePriorSelections = useCallback(
    (replace: ReplacePlan, incumbentCourse: Course | null) => {
      if (incumbentCourse) {
        snapshotsRef.current = {
          ...snapshotsRef.current,
          [incumbentCourse.id]: courseToSnapshot(incumbentCourse),
        };
      }
      commit((s) => {
        const slotSelections = { ...s.slotSelections };
        for (const [sid, cid] of Object.entries(replace.undoSelections)) {
          if (cid === null) delete slotSelections[sid];
          else slotSelections[sid] = cid;
        }
        const selectedCourses = { ...s.selectedCourses };
        if (incumbentCourse) selectedCourses[incumbentCourse.id] = incumbentCourse;
        return { ...s, slotSelections, selectedCourses };
      });
    },
    [commit]
  );

  const assignSlot = useCallback(
    (slotId: string, course: Course) => {
      // Capture prior state BEFORE mutating, to know the incumbent (if any) and
      // where the incoming course was — the exact data an undo needs (spec 009 §2).
      const prev = stateRef.current;
      const replace = buildReplacePlan(prev.slotSelections, slotId, course.id);
      const incumbentCourse = replace.incumbentCourseId
        ? (prev.selectedCourses[replace.incumbentCourseId] ?? null)
        : null;

      // Keep courseSnapshots in sync (add this course's display snapshot).
      snapshotsRef.current = {
        ...snapshotsRef.current,
        [course.id]: courseToSnapshot(course),
      };
      commit((s) => {
        // A course fills only one slot: remove it from any previous slot.
        const slotSelections = Object.fromEntries(
          Object.entries(s.slotSelections).filter(([, cId]) => cId !== course.id)
        );
        slotSelections[slotId] = course.id;
        return {
          ...s,
          slotSelections,
          selectedCourses: { ...s.selectedCourses, [course.id]: course },
        };
      });

      // Drops never lie (spec 009 §2 / #5): landing on a slot that held a
      // DIFFERENT course is a replace — the incumbent is unplaced and an undo
      // toast restores the exact prior state.
      if (replace.isReplace) {
        const incCode = incumbentCourse
          ? `${incumbentCourse.subject} ${incumbentCourse.number}`
          : "the course";
        showToast(`Replaced ${incCode} with ${course.subject} ${course.number}`, {
          actionLabel: "Undo",
          onAction: () => restorePriorSelections(replace, incumbentCourse),
        });
      }
    },
    [commit, showToast, restorePriorSelections]
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      commit((s) => {
        const slotSelections = { ...s.slotSelections };
        const removedCourseId = slotSelections[slotId];
        delete slotSelections[slotId];
        // Drop the course snapshot if nothing else references it.
        if (removedCourseId && !Object.values(slotSelections).includes(removedCourseId)) {
          const { [removedCourseId]: _drop, ...rest } = snapshotsRef.current as Record<
            string,
            unknown
          >;
          void _drop;
          snapshotsRef.current = rest;
          const selectedCourses = { ...s.selectedCourses };
          delete selectedCourses[removedCourseId];
          return { ...s, slotSelections, selectedCourses };
        }
        return { ...s, slotSelections };
      });
    },
    [commit]
  );

  // One slot lives in at most one manual state (spec 006 §B.1). Each toggle,
  // when turning ON, clears the two sibling states; the filters are harmless
  // no-ops when turning OFF (the sibling arrays don't hold this slot anyway).
  const toggleCompleted = useCallback(
    (slotId: string) => {
      commit((s) => ({
        ...s,
        completedSlotIds: s.completedSlotIds.includes(slotId)
          ? s.completedSlotIds.filter((id) => id !== slotId)
          : [...s.completedSlotIds, slotId],
        waivedSlotIds: s.waivedSlotIds.filter((id) => id !== slotId), // completing clears waiver
        inProgressSlotIds: s.inProgressSlotIds.filter((id) => id !== slotId), // …and in-progress
      }));
    },
    [commit]
  );

  const toggleWaived = useCallback(
    (slotId: string) => {
      commit((s) => ({
        ...s,
        waivedSlotIds: s.waivedSlotIds.includes(slotId)
          ? s.waivedSlotIds.filter((id) => id !== slotId)
          : [...s.waivedSlotIds, slotId],
        completedSlotIds: s.completedSlotIds.filter((id) => id !== slotId), // waiving clears completion
        inProgressSlotIds: s.inProgressSlotIds.filter((id) => id !== slotId), // …and in-progress
      }));
    },
    [commit]
  );

  const toggleInProgress = useCallback(
    (slotId: string) => {
      commit((s) => ({
        ...s,
        inProgressSlotIds: s.inProgressSlotIds.includes(slotId)
          ? s.inProgressSlotIds.filter((id) => id !== slotId)
          : [...s.inProgressSlotIds, slotId],
        completedSlotIds: s.completedSlotIds.filter((id) => id !== slotId), // in-progress clears completion
        waivedSlotIds: s.waivedSlotIds.filter((id) => id !== slotId), // …and waiver
      }));
    },
    [commit]
  );

  const resetPlan = useCallback(() => {
    snapshotsRef.current = {};
    commit(() => ({ ...EMPTY }));
  }, [commit]);

  // ── Roadmap mutability (spec 005 §9) ───────────────────────────────────────
  const moveSlot = useCallback(
    (slotId: string, sem: number) => {
      const clamped = Math.min(10, Math.max(1, sem));
      commit((s) => {
        const isCustom = s.customSlots.some((c) => c.id === slotId);
        if (isCustom) {
          return {
            ...s,
            customSlots: s.customSlots.map((c) =>
              c.id === slotId ? { ...c, sem: clamped } : c
            ),
          };
        }
        const prev = s.slotOverrides[slotId] ?? {};
        return {
          ...s,
          slotOverrides: { ...s.slotOverrides, [slotId]: { ...prev, sem: clamped } },
        };
      });
    },
    [commit]
  );

  // Shared cleanup when a slot leaves the graph: its selection, snapshot (if
  // orphaned), and completed/waived marks go with it for CUSTOM slots; template
  // slots keep their contents so restore is a full recovery.
  const removeSlot = useCallback(
    (slotId: string) => {
      commit((s) => {
        const isCustom = s.customSlots.some((c) => c.id === slotId);
        if (!isCustom) {
          const prev = s.slotOverrides[slotId] ?? {};
          return {
            ...s,
            slotOverrides: { ...s.slotOverrides, [slotId]: { ...prev, removed: true } },
          };
        }
        const slotSelections = { ...s.slotSelections };
        const removedCourseId = slotSelections[slotId];
        delete slotSelections[slotId];
        const selectedCourses = { ...s.selectedCourses };
        if (removedCourseId && !Object.values(slotSelections).includes(removedCourseId)) {
          const { [removedCourseId]: _drop, ...rest } = snapshotsRef.current;
          void _drop;
          snapshotsRef.current = rest;
          delete selectedCourses[removedCourseId];
        }
        return {
          ...s,
          customSlots: s.customSlots.filter((c) => c.id !== slotId),
          slotSelections,
          selectedCourses,
          completedSlotIds: s.completedSlotIds.filter((id) => id !== slotId),
          waivedSlotIds: s.waivedSlotIds.filter((id) => id !== slotId),
          inProgressSlotIds: s.inProgressSlotIds.filter((id) => id !== slotId),
        };
      });
    },
    [commit]
  );

  const restoreSlot = useCallback(
    (slotId: string) => {
      commit((s) => {
        const prev = s.slotOverrides[slotId];
        if (!prev?.removed) return s;
        const { removed: _r, ...rest } = prev;
        void _r;
        const slotOverrides = { ...s.slotOverrides };
        if (rest.sem != null) slotOverrides[slotId] = rest;
        else delete slotOverrides[slotId];
        return { ...s, slotOverrides };
      });
    },
    [commit]
  );

  const addCustomSlot = useCallback(
    (sem: number, title?: string): string => {
      const id = `cus-${crypto.randomUUID()}`;
      const clamped = Math.min(10, Math.max(1, sem));
      // NEVER include an undefined field — Firestore rejects undefined values
      // in updateDoc payloads (the write fails, not just the field).
      const slot: CustomSlot = title ? { id, sem: clamped, title } : { id, sem: clamped };
      commit((s) => {
        if (s.customSlots.length >= 40) return s; // rules cap — quietly refuse
        return {
          ...s,
          customSlots: [...s.customSlots, slot],
        };
      });
      return id;
    },
    [commit]
  );

  // ── Plan switcher (spec 005 §6): multiple plans per program ────────────────
  const switchPlan = useCallback(
    async (targetPlanId: string, targetProgramId: string) => {
      flushPendingWrite(); // never drop an in-flight mutation on switch
      await setActivePlanId(targetPlanId);
      const store = useProgramStore.getState();
      if (store.selectedProgramId !== targetProgramId) {
        // Program change re-runs resolution, which now prefers activePlanId.
        store.setSelectedProgramId(targetProgramId);
      } else {
        setPlanId(targetPlanId); // same program — subscribe directly
      }
    },
    [flushPendingWrite, setActivePlanId]
  );

  const createNewPlan = useCallback(
    async (programId: string, name: string) => {
      const uidNow = uidRef.current;
      if (!uidNow) return;
      flushPendingWrite();
      const newId = crypto.randomUUID();
      lastWrittenRef.current = null;
      await createPlan(uidNow, newId, {
        name: name.trim().slice(0, 80) || "My Plan",
        programId,
      });
      setPlansList((l) => [...l, { id: newId, name, programId }]);
      await switchPlan(newId, programId);
      setResolveKey((k) => k + 1);
    },
    [flushPendingWrite, switchPlan]
  );

  const deletePlan = useCallback(
    async (targetPlanId: string) => {
      const uidNow = uidRef.current;
      if (!uidNow) return;
      if (targetPlanId === planIdRef.current) {
        // Leaving the doc we're subscribed to: drop the pending write for it.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        pendingWriteRef.current = null;
        setPlanId(null);
      }
      await deletePlanDoc(uidNow, targetPlanId);
      setPlansList((l) => l.filter((p) => p.id !== targetPlanId));
      setResolveKey((k) => k + 1); // re-resolve (next plan or auto-create)
    },
    []
  );

  const renamePlan = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    const uidNow = uidRef.current;
    const planIdNow = planIdRef.current;
    if (!uidNow || !planIdNow) return;
    setPlanName(trimmed); // optimistic
    setPlansList((l) => l.map((p) => (p.id === planIdNow ? { ...p, name: trimmed } : p)));
    updatePlan(uidNow, planIdNow, { name: trimmed }).catch((err) => {
      console.warn("[plan] rename failed", err);
      setPlanError(true);
    });
  }, []);

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      planId,
      planName,
      planLoading,
      planError,
      assignSlot,
      clearSlot,
      toggleCompleted,
      toggleWaived,
      toggleInProgress,
      resetPlan,
      renamePlan,
      moveSlot,
      removeSlot,
      restoreSlot,
      addCustomSlot,
      plansList,
      switchPlan,
      createNewPlan,
      deletePlan,
    }),
    [
      state,
      planId,
      planName,
      planLoading,
      planError,
      assignSlot,
      clearSlot,
      toggleCompleted,
      toggleWaived,
      toggleInProgress,
      resetPlan,
      renamePlan,
      moveSlot,
      removeSlot,
      restoreSlot,
      addCustomSlot,
      plansList,
      switchPlan,
      createNewPlan,
      deletePlan,
    ]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlanContext(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanContext must be used within PlanProvider");
  return ctx;
}
