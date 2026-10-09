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
  type UpdatePlanPatch,
} from "@/services/plans";
import type { NormalizedPlan } from "@/lib/normalize/normalizePlan";
import { PLAN_SCHEMA_VERSION } from "@/lib/schemas";
import { snapshotToCourse, courseToSnapshot } from "@/lib/normalize/courseSnapshot";
import type { Course, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";
import { usePlannerStore } from "@/store/usePlannerStore";
import type { RemapTargetSlot } from "@/lib/planner/remapPlacements";
import {
  MAX_PLACEMENTS,
  insertPlacement,
  movePlacementTo,
  removePlacementById,
  startingPlacements,
} from "@/lib/planner/placementOps";
import { seedPlanFromPrevious, planContentIsEmpty } from "@/lib/planner/seedPlanFromPrevious";

/**
 * PlanProvider (docs/specs/002 §6; plan model = spec 014 course PLACEMENTS) —
 * owns the authoritative cloud plan and all plan mutations.
 *
 * Model (spec 014 §D1/§D5): the board is an ordered list of placements per
 * semester; requirements are attribution (majorMatch), not containers. State:
 *   placements, placedCourses (courseId → Course), completedIds /
 *   inProgressIds (placement ids — one manual state per placement),
 *   waivedRequirementIds (requirement ids).
 *
 * Sync recipe (standard layout-persistence): self-write, 600ms debounce,
 * echo-suppress, sanitize-on-load.
 *   - onSnapshot(users/{uid}/plans/{activePlanId}) is the source of truth.
 *   - Mutations apply OPTIMISTICALLY to local state and write through
 *     updatePlan() debounced 600ms.
 *   - lastWrittenRef holds a signature of our own last write; the snapshot that
 *     round-trips it is ignored (echo suppression).
 *   - A FAILED write rolls the optimistic state back to the last state the
 *     server confirmed AND says so with a toast (fail-closed rules shipped
 *     silent ~300ms rollbacks twice before — never again).
 *   - sanitize-on-load lives in normalizePlan (older schemaVersion → EMPTY).
 *
 * Starting board (spec 014 §D6): a plan that loads EMPTY (new, legacy, or
 * emptied) gets one placement per fixed single-course requirement of its
 * program, laid down once per plan load and saved through the normal write.
 *
 * Auto-create: a fresh user with no plan for the selected program gets a plan
 * auto-created (name defaulted to the program shortName). Each program has its
 * OWN plan document.
 */

const DEBOUNCE_MS = 600;

type PlanState = {
  placements: Placement[];
  placedCourses: Record<string, Course>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
};

type PlanContextValue = PlanState & {
  planId: string | null;
  planName: string | null;
  planLoading: boolean;
  planError: boolean;
  /** Place `course` in `sem` at `index` (omitted = append). Returns the new
   *  placement id, or null — with a toast, never silently — at the cap. */
  addPlacement: (course: Course, sem: number, index?: number) => string | null;
  /** Move a placement; `index` = position in the TARGET column after the mover
   *  is taken out (0 = top; past the end = append). */
  movePlacement: (id: string, sem: number, index: number) => void;
  /** Remove a placement (and its marks); an Undo toast restores it exactly. */
  removePlacement: (id: string) => void;
  /** Toggle "completed" on a placement; clears in-progress (one manual state). */
  toggleCompleted: (id: string) => void;
  /** Toggle "currently taking" on a placement; clears completed. */
  toggleInProgress: (id: string) => void;
  /** Toggle a requirement waiver (requirement id = template slot id). */
  toggleWaivedRequirement: (requirementId: string) => void;
  /** Reset to the current program's starting board (spec 014 §D6). */
  resetPlan: () => void;
  /** Rename the active plan (spec 004 §"intimate": the plan has a name). */
  renamePlan: (name: string) => void;
  // ── Plan switcher (spec 005 §6, multiple plans per program) ──
  plansList: PlanListItem[];
  switchPlan: (planId: string, programId: string) => Promise<void>;
  createNewPlan: (programId: string, name: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const EMPTY: PlanState = {
  placements: [],
  placedCourses: {},
  completedIds: [],
  inProgressIds: [],
  waivedRequirementIds: [],
};

/** Requirement-waiver cap — keep in sync with schemas.ts / firestore.rules. */
const MAX_WAIVERS = 80;

/** Keep placedCourses to exactly the courses on the board (same ref when
 *  nothing to drop). */
function pruneCourses(s: PlanState): PlanState {
  const used = new Set(s.placements.map((p) => p.courseId));
  const keys = Object.keys(s.placedCourses);
  if (keys.every((k) => used.has(k))) return s;
  const placedCourses: Record<string, Course> = {};
  for (const k of keys) if (used.has(k)) placedCourses[k] = s.placedCourses[k];
  return { ...s, placedCourses };
}

/** The doc payload for a plan state. Every value is defined (Firestore rejects
 *  undefined and fails the whole write). */
function toPayload(s: PlanState) {
  const courseSnapshots: Record<string, unknown> = {};
  for (const p of s.placements) {
    if (courseSnapshots[p.courseId]) continue;
    const c = s.placedCourses[p.courseId] ?? snapshotToCourse(p.courseId, null);
    courseSnapshots[p.courseId] = courseToSnapshot(c);
  }
  return {
    placements: s.placements.map((p) => ({
      id: p.id,
      courseId: p.courseId,
      sem: p.sem,
      order: p.order,
    })),
    courseSnapshots,
    completedIds: s.completedIds,
    inProgressIds: s.inProgressIds,
    waivedRequirementIds: s.waivedRequirementIds,
    schemaVersion: PLAN_SCHEMA_VERSION,
  };
}

// Stable signature of the writable plan fields, for echo suppression.
function planSignature(p: {
  placements: Placement[];
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  courseSnapshots: Record<string, unknown>;
}): string {
  return JSON.stringify({
    p: [...p.placements]
      .map((x) => [x.id, x.courseId, x.sem, x.order])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    c: [...p.completedIds].sort(),
    ip: [...p.inProgressIds].sort(),
    w: [...p.waivedRequirementIds].sort(),
    cs: Object.keys(p.courseSnapshots).sort(),
  });
}

const EMPTY_SIGNATURE = planSignature({ ...EMPTY, courseSnapshots: {} });

// A program slot as the C4 matcher needs it (spec 009 §4) — used only to count
// how many carried courses fill a new-program requirement for the toast.
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

/** The Course objects of a template's fixed course slots, by course id. */
function templateCourses(slots: ProgramSlotWithData[]): Record<string, Course> {
  const out: Record<string, Course> = {};
  for (const s of slots) if (s.kind === "course" && s.courses) out[s.courses.id] = s.courses;
  return out;
}

const FAILED_WRITE_TOAST = "Couldn't save your last change — check your connection and try again.";

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { uid, profile, loading: authLoading, setActivePlanId } = useAuth();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs, getProgramData, loadProgramData } = useProgramContext();
  // Toast surface — the remove/undo affordance, the C4 program-switch summary,
  // the cap refusal and the failed-write notice. Zustand actions are stable.
  const showToast = usePlannerStore((s) => s.showToast);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>(EMPTY);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(false);
  const [plansList, setPlansList] = useState<PlanListItem[]>([]);
  // Bumped after create/delete to force the resolution effect to re-run.
  const [resolveKey, setResolveKey] = useState(0);

  // Mirror of `state` for synchronous reads inside mutations (capturing what a
  // removal's undo needs, the cap check) without threading `state` through deps.
  const stateRef = useRef<PlanState>(EMPTY);
  // The last state the SERVER is known to hold (applied from a snapshot, or a
  // write that succeeded) — the rollback target for a failed write.
  const confirmedRef = useRef<PlanState>(EMPTY);
  // ── C4 cross-plan carry-over (spec 009 §4, per-program-plan architecture) ──
  // A real major switch swaps plan DOCUMENTS. At switch time we capture the
  // outgoing plan's state as the seed source; if the target program's plan
  // turns out MISSING/EMPTY, applyLoadedPlan seeds it.
  const pendingSeedRef = useRef<{ toProgramId: string; prevState: PlanState } | null>(null);
  // The program the currently-loaded state belongs to (last resolved program).
  const lastProgramIdRef = useRef<string | null>(null);
  // Plan id we just seeded (carry-over or starting board): a stale EMPTY
  // snapshot (emitted before the seed's debounced write lands) must not wipe
  // the seeded optimistic state, and the board is laid down once per load.
  const seededPlanRef = useRef<string | null>(null);
  // Fresh view of the program list for the C4 summary (short name), read at
  // snapshot time without adding churn to applyLoadedPlan's deps.
  const programsRef = useRef(programs);
  useEffect(() => {
    programsRef.current = programs;
  }, [programs]);

  // Echo suppression: signature of our own last write; the snapshot matching it
  // is skipped.
  const lastWrittenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending (un-flushed) debounced write, captured so a plan switch / unmount can
  // flush it immediately instead of dropping the mutation.
  const pendingWriteRef = useRef<{
    uid: string;
    planId: string;
    state: PlanState;
    payload: ReturnType<typeof toPayload>;
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
      lastProgramIdRef.current = null;
      pendingSeedRef.current = null;
      return;
    }
    // C4 cross-plan carry-over capture (spec 009 §4): on a REAL program switch,
    // grab the outgoing plan's state NOW — synchronously, before the plan
    // subscription swaps docs and clears it. Consumed by applyLoadedPlan only
    // if the target program's plan turns out missing/empty; a re-run of this
    // effect for the SAME program captures nothing and leaves a pending seed.
    if (lastProgramIdRef.current && lastProgramIdRef.current !== selectedProgramId) {
      pendingSeedRef.current = { toProgramId: selectedProgramId, prevState: stateRef.current };
    }
    lastProgramIdRef.current = selectedProgramId;

    let cancelled = false;
    (async () => {
      try {
        const existing = await listPlans(uid);
        if (cancelled) return;
        setPlansList(existing);

        // The starting board / a pending seed need the TARGET program's slots
        // cached before the plan snapshot arrives (applyLoadedPlan reads the
        // cache synchronously). Await it so seeding can't miss its window.
        await loadProgramData(selectedProgramId).catch(() => null);
        if (cancelled) return;

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
        lastWrittenRef.current = EMPTY_SIGNATURE;
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
    // New plan focus: clear the previous plan's state + echo signature so its
    // data can't bleed into this plan's view (the first snapshot repopulates).
    setState(EMPTY);
    stateRef.current = EMPTY;
    confirmedRef.current = EMPTY;
    setPlanName(null);
    lastWrittenRef.current = null;
    // A fresh load of this plan may seed again (the post-seed guard below is
    // per subscription, not per session).
    seededPlanRef.current = null;

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
      // Name updates apply even on echo-suppressed / post-seed snapshots
      // (renames write outside the debounced payload).
      setPlanName(plan.name || null);

      // Post-seed guard: after seeding this plan (carry-over or starting
      // board), a stale EMPTY snapshot — emitted before the seed's debounced
      // write lands — must not wipe the seeded optimistic view.
      if (seededPlanRef.current === planId && planContentIsEmpty(plan)) {
        return;
      }

      // Echo suppression: ignore the snapshot that round-trips our own write.
      const sig = planSignature(plan);
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
    const payload = JSON.parse(JSON.stringify(pending.payload)) as UpdatePlanPatch &
      ReturnType<typeof toPayload>;
    // Record the signature so the resulting snapshot is echo-suppressed.
    lastWrittenRef.current = planSignature(payload);
    updatePlan(pending.uid, pending.planId, payload)
      .then(() => {
        if (planIdRef.current === pending.planId) confirmedRef.current = pending.state;
      })
      .catch((err) => {
        console.warn("[plan] write failed", err);
        // Never a silent rollback: restore what the server holds AND say so.
        if (planIdRef.current === pending.planId) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = null;
          pendingWriteRef.current = null;
          lastWrittenRef.current = null;
          const back = confirmedRef.current;
          stateRef.current = back;
          setState(back);
        }
        usePlannerStore.getState().showToast(FAILED_WRITE_TOAST);
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
        state: next,
        payload: toPayload(next),
      };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushPendingWrite, DEBOUNCE_MS);
    },
    [flushPendingWrite]
  );

  /** The starting board (spec 014 §D6) for a program, or null if its template
   *  isn't cached yet. */
  const startingStateFor = useCallback(
    (programId: string): PlanState | null => {
      const data = getProgramData(programId);
      if (!data) return null;
      return pruneCourses({
        ...EMPTY,
        placements: startingPlacements(data.slots),
        placedCourses: templateCourses(data.slots),
      });
    },
    [getProgramData]
  );

  /** Lay the starting board down on an EMPTY loaded plan, once per load. */
  const layStartingBoard = useCallback(
    (programId: string, forPlanId: string) => {
      const apply = () => {
        if (planIdRef.current !== forPlanId) return; // switched away meanwhile
        if (seededPlanRef.current === forPlanId) return; // already laid down
        if (!planContentIsEmpty(stateRef.current)) return; // student acted first
        const next = startingStateFor(programId);
        if (!next || next.placements.length === 0) return; // nothing fixed to place
        seededPlanRef.current = forPlanId;
        stateRef.current = next;
        setState(next);
        scheduleWrite(next);
      };
      if (getProgramData(programId)) apply();
      else
        loadProgramData(programId)
          .then(apply)
          .catch(() => {});
    },
    [getProgramData, loadProgramData, startingStateFor, scheduleWrite]
  );

  // Project a loaded plan into state; seed it when it's empty (carry-over from
  // the previous major first, else the program's starting board).
  const applyLoadedPlan = useCallback(
    (plan: NormalizedPlan) => {
      const forPlanId = planIdRef.current;

      // ── C4 cross-plan seeding (spec 009 §4): a major switch lands on the new
      //    program's OWN plan doc. If that plan is MISSING/EMPTY and a
      //    carry-over seed is pending, its initial state is the previous
      //    plan's placements plus the new program's starting board. Consumed
      //    at most once per switch; a NON-empty plan loads untouched (the
      //    user's prior work on that major). The OLD doc is never modified. ──
      const pendingSeed = pendingSeedRef.current;
      if (pendingSeed && pendingSeed.toProgramId === plan.programId) {
        pendingSeedRef.current = null;
        const target = getProgramData(plan.programId);
        if (planContentIsEmpty(plan) && target && forPlanId) {
          const prev = pendingSeed.prevState;
          const seed = seedPlanFromPrevious(
            {
              placements: prev.placements,
              placedCourses: prev.placedCourses,
              completedIds: prev.completedIds,
              inProgressIds: prev.inProgressIds,
            },
            target.slots.map(toRemapTarget),
            startingPlacements(target.slots)
          );
          if (seed) {
            const fromTemplate = templateCourses(target.slots);
            const placedCourses: Record<string, Course> = {};
            for (const cid of seed.courseIds) {
              const c = prev.placedCourses[cid] ?? fromTemplate[cid];
              placedCourses[cid] = c ?? snapshotToCourse(cid, null);
            }
            const next: PlanState = {
              placements: seed.placements,
              placedCourses,
              completedIds: seed.completedIds,
              inProgressIds: seed.inProgressIds,
              waivedRequirementIds: [], // waivers are the OLD program's requirement ids
            };
            confirmedRef.current = EMPTY;
            seededPlanRef.current = forPlanId;
            stateRef.current = next;
            setState(next);
            // Persist through the NORMAL debounced save — planIdRef already
            // points at the NEW plan doc, so only that doc is written.
            scheduleWrite(next);
            const shortName =
              programsRef.current.find((p) => p.id === plan.programId)?.short_name ??
              "the new major";
            const keptPhrase =
              seed.kept === 1 ? "Kept your course" : `Kept your ${seed.kept} courses`;
            showToast(
              seed.matched > 0
                ? `${keptPhrase} — ${seed.matched} count toward ${shortName} requirements`
                : `${keptPhrase} on your new board`
            );
            return;
          }
        }
      }

      const placedCourses: Record<string, Course> = {};
      for (const p of plan.placements) {
        if (!placedCourses[p.courseId]) {
          placedCourses[p.courseId] = snapshotToCourse(p.courseId, plan.courseSnapshots[p.courseId]);
        }
      }
      const next: PlanState = {
        placements: plan.placements,
        placedCourses,
        completedIds: plan.completedIds,
        inProgressIds: plan.inProgressIds,
        waivedRequirementIds: plan.waivedRequirementIds,
      };
      confirmedRef.current = next;
      stateRef.current = next;
      setState(next);

      // New, legacy (older schemaVersion → read as empty) or emptied plan →
      // the program's starting board (spec 014 §D5/§D6).
      if (forPlanId && planContentIsEmpty(plan)) layStartingBoard(plan.programId, forPlanId);
    },
    [getProgramData, showToast, scheduleWrite, layStartingBoard]
  );

  // ── Mutations (optimistic state + debounced write) ─────────────────────────
  const commit = useCallback(
    (updater: (s: PlanState) => PlanState) => {
      const prev = stateRef.current;
      const next = updater(prev);
      if (next === prev) return;
      stateRef.current = next;
      setState(next);
      scheduleWrite(next);
    },
    [scheduleWrite]
  );

  const addPlacement = useCallback(
    (course: Course, sem: number, index?: number): string | null => {
      if (stateRef.current.placements.length >= MAX_PLACEMENTS) {
        showToast(
          `Your board holds up to ${MAX_PLACEMENTS} courses — remove one to add ${course.subject} ${course.number}.`
        );
        return null;
      }
      const id = crypto.randomUUID();
      commit((s) => {
        const placements = insertPlacement(s.placements, { id, courseId: course.id }, sem, index);
        if (placements === s.placements) return s;
        return { ...s, placements, placedCourses: { ...s.placedCourses, [course.id]: course } };
      });
      return id;
    },
    [commit, showToast]
  );

  const movePlacement = useCallback(
    (id: string, sem: number, index: number) => {
      commit((s) => {
        const placements = movePlacementTo(s.placements, id, sem, index);
        return placements === s.placements ? s : { ...s, placements };
      });
    },
    [commit]
  );

  const removePlacement = useCallback(
    (id: string) => {
      // Capture everything the undo needs BEFORE mutating (spec 014 §D8): the
      // exact placement (id, column, position), its course, and its mark.
      const prev = stateRef.current;
      const placement = prev.placements.find((p) => p.id === id);
      if (!placement) return;
      const course = prev.placedCourses[placement.courseId] ?? null;
      const wasCompleted = prev.completedIds.includes(id);
      const wasInProgress = prev.inProgressIds.includes(id);

      commit((s) =>
        pruneCourses({
          ...s,
          placements: removePlacementById(s.placements, id),
          completedIds: s.completedIds.filter((x) => x !== id),
          inProgressIds: s.inProgressIds.filter((x) => x !== id),
        })
      );

      const code = course ? `${course.subject} ${course.number}` : placement.courseId.replace(/-/g, " ");
      showToast(`Removed ${code} from your board`, {
        actionLabel: "Undo",
        onAction: () =>
          commit((s) => {
            if (s.placements.some((p) => p.id === id)) return s; // already back
            const placements = insertPlacement(
              s.placements,
              { id, courseId: placement.courseId },
              placement.sem,
              placement.order
            );
            if (placements === s.placements) return s; // cap reached meanwhile
            return {
              ...s,
              placements,
              placedCourses: course
                ? { ...s.placedCourses, [course.id]: course }
                : s.placedCourses,
              completedIds: wasCompleted ? [...s.completedIds, id] : s.completedIds,
              inProgressIds: wasInProgress ? [...s.inProgressIds, id] : s.inProgressIds,
            };
          }),
      });
    },
    [commit, showToast]
  );

  // One placement lives in at most one manual state (spec 006 §B.1). Turning
  // one ON clears the other; turning OFF just removes it. Unknown ids no-op.
  const toggleCompleted = useCallback(
    (id: string) => {
      commit((s) => {
        if (!s.placements.some((p) => p.id === id)) return s;
        const on = !s.completedIds.includes(id);
        return {
          ...s,
          completedIds: on ? [...s.completedIds, id] : s.completedIds.filter((x) => x !== id),
          inProgressIds: s.inProgressIds.filter((x) => x !== id),
        };
      });
    },
    [commit]
  );

  const toggleInProgress = useCallback(
    (id: string) => {
      commit((s) => {
        if (!s.placements.some((p) => p.id === id)) return s;
        const on = !s.inProgressIds.includes(id);
        return {
          ...s,
          inProgressIds: on ? [...s.inProgressIds, id] : s.inProgressIds.filter((x) => x !== id),
          completedIds: s.completedIds.filter((x) => x !== id),
        };
      });
    },
    [commit]
  );

  const toggleWaivedRequirement = useCallback(
    (requirementId: string) => {
      const cur = stateRef.current.waivedRequirementIds;
      if (!cur.includes(requirementId) && cur.length >= MAX_WAIVERS) {
        showToast(`You can waive up to ${MAX_WAIVERS} requirements.`);
        return;
      }
      commit((s) => ({
        ...s,
        waivedRequirementIds: s.waivedRequirementIds.includes(requirementId)
          ? s.waivedRequirementIds.filter((x) => x !== requirementId)
          : [...s.waivedRequirementIds, requirementId],
      }));
    },
    [commit, showToast]
  );

  const resetPlan = useCallback(() => {
    const pid = useProgramStore.getState().selectedProgramId;
    const start = pid ? startingStateFor(pid) : null;
    commit(() => start ?? { ...EMPTY });
    if (pid && !start) {
      // Template not cached yet — lay the starting board down once it is.
      loadProgramData(pid)
        .then(() => {
          const late = startingStateFor(pid);
          if (late && planContentIsEmpty(stateRef.current)) commit(() => late);
        })
        .catch(() => {});
    }
  }, [commit, startingStateFor, loadProgramData]);

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

  const renamePlan = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 80);
      if (!trimmed) return;
      const uidNow = uidRef.current;
      const planIdNow = planIdRef.current;
      if (!uidNow || !planIdNow) return;
      const previousName = planName;
      setPlanName(trimmed); // optimistic
      setPlansList((l) => l.map((p) => (p.id === planIdNow ? { ...p, name: trimmed } : p)));
      updatePlan(uidNow, planIdNow, { name: trimmed }).catch((err) => {
        console.warn("[plan] rename failed", err);
        // Roll back AND say so (never a silent rollback).
        if (planIdRef.current === planIdNow) setPlanName(previousName);
        setPlansList((l) =>
          l.map((p) => (p.id === planIdNow ? { ...p, name: previousName ?? p.name } : p))
        );
        showToast("Couldn't rename your plan — check your connection and try again.");
      });
    },
    [planName, showToast]
  );

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      planId,
      planName,
      planLoading,
      planError,
      addPlacement,
      movePlacement,
      removePlacement,
      toggleCompleted,
      toggleInProgress,
      toggleWaivedRequirement,
      resetPlan,
      renamePlan,
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
      addPlacement,
      movePlacement,
      removePlacement,
      toggleCompleted,
      toggleInProgress,
      toggleWaivedRequirement,
      resetPlan,
      renamePlan,
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
