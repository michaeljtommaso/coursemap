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
  listPlans,
} from "@/services/plans";
import type { NormalizedPlan } from "@/lib/normalize/normalizePlan";
import type { Course } from "@/types/db";

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
  selectedCourses: Record<string, Course>;
};

type PlanContextValue = PlanState & {
  planId: string | null;
  planLoading: boolean;
  planError: boolean;
  assignSlot: (slotId: string, course: Course) => void;
  clearSlot: (slotId: string) => void;
  toggleCompleted: (slotId: string) => void;
  toggleWaived: (slotId: string) => void;
  resetPlan: () => void;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const EMPTY: PlanState = {
  slotSelections: {},
  completedSlotIds: [],
  waivedSlotIds: [],
  selectedCourses: {},
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
    roster_id: null,
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

// Stable signature of the writable plan fields, for echo suppression.
function planSignature(p: {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  waivedSlotIds: string[];
  courseSnapshots: Record<string, unknown>;
}): string {
  return JSON.stringify({
    s: Object.keys(p.slotSelections)
      .sort()
      .map((k) => [k, p.slotSelections[k]]),
    c: [...p.completedSlotIds].sort(),
    w: [...p.waivedSlotIds].sort(),
    cs: Object.keys(p.courseSnapshots).sort(),
  });
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { uid, profile, loading: authLoading, setActivePlanId } = useAuth();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { programs } = useProgramContext();

  const [planId, setPlanId] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>(EMPTY);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(false);

  // Mutable plan-doc fields we hold for writing (courseSnapshots isn't projected
  // into `state` as-is — we keep the raw map here so writes are lossless).
  const snapshotsRef = useRef<Record<string, unknown>>({});
  // Echo suppression: signature of our own last write; the snapshot matching it
  // is skipped. Also suppress the very first optimistic->write round-trip.
  const lastWrittenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // ── Resolve which plan is active for the selected program ──────────────────
  // Order: profile.activePlanId (if it's for this program) → an existing plan for
  // this program → auto-create (name = program shortName). Runs when uid/profile/
  // selectedProgramId settle.
  useEffect(() => {
    if (authLoading || !uid || !profile) return;
    if (!selectedProgramId || selectedProgramId.startsWith("custom-")) {
      // No real program selected — clear the active plan view.
      setPlanId(null);
      setState(EMPTY);
      snapshotsRef.current = {};
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const existing = await listPlans(uid);
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
        lastWrittenRef.current = planSignature({
          slotSelections: {},
          completedSlotIds: [],
          waivedSlotIds: [],
          courseSnapshots: {},
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
    // don't want that write to retrigger resolution. uid + program are the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authLoading, selectedProgramId, programs]);

  // ── Subscribe to the active plan doc ───────────────────────────────────────
  useEffect(() => {
    if (!uid || !planId) return;
    setPlanLoading(true);
    setPlanError(false);

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

      const sig = planSignature({
        slotSelections: plan.slotSelections,
        completedSlotIds: plan.completedSlotIds,
        waivedSlotIds: plan.waivedSlotIds,
        courseSnapshots: plan.courseSnapshots,
      });
      // Echo suppression: ignore the snapshot that round-trips our own write.
      if (lastWrittenRef.current !== null && sig === lastWrittenRef.current) {
        return;
      }

      applyLoadedPlan(plan);
    });

    return () => {
      unsub();
      // Flush any pending write for the plan we're leaving.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // applyLoadedPlan is stable (defined below via useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, planId]);

  // Program slot IDs for the currently selected program, or null if not loaded.
  const { getProgramData } = useProgramContext();
  const getCurrentProgramSlotIds = useCallback((): Set<string> | null => {
    const pid = useProgramStore.getState().selectedProgramId;
    if (!pid) return null;
    const data = getProgramData(pid);
    if (!data) return null;
    return new Set(data.slots.map((s) => s.id));
  }, [getProgramData]);

  // Sanitize-on-load + project courseSnapshots → selectedCourses.
  const applyLoadedPlan = useCallback(
    (plan: NormalizedPlan) => {
      // Current program's slot IDs (for pruning stale selections). Read lazily so
      // we don't tie the subscription to program-data load ordering.
      const programData = getCurrentProgramSlotIds();
      const validSlot = (slotId: string) =>
        programData === null ? true : programData.has(slotId);

      const slotSelections: Record<string, string> = {};
      for (const [slotId, courseId] of Object.entries(plan.slotSelections)) {
        if (validSlot(slotId)) slotSelections[slotId] = courseId;
      }
      const completedSlotIds = plan.completedSlotIds.filter(validSlot);
      const waivedSlotIds = plan.waivedSlotIds.filter(validSlot);

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

      setState({ slotSelections, completedSlotIds, waivedSlotIds, selectedCourses });
    },
    [getCurrentProgramSlotIds]
  );

  // ── Debounced write-through ────────────────────────────────────────────────
  const scheduleWrite = useCallback((next: PlanState) => {
    const uidNow = uidRef.current;
    const planIdNow = planIdRef.current;
    if (!uidNow || !planIdNow) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const courseSnapshots = snapshotsRef.current;
      const payload = {
        slotSelections: next.slotSelections,
        completedSlotIds: next.completedSlotIds,
        waivedSlotIds: next.waivedSlotIds,
        courseSnapshots,
      };
      // Record the signature so the resulting snapshot is echo-suppressed.
      lastWrittenRef.current = planSignature(payload);
      updatePlan(uidNow, planIdNow, payload).catch((err) => {
        console.warn("[plan] write failed", err);
        setPlanError(true);
      });
    }, DEBOUNCE_MS);
  }, []);

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

  const assignSlot = useCallback(
    (slotId: string, course: Course) => {
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
    },
    [commit]
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

  const toggleCompleted = useCallback(
    (slotId: string) => {
      commit((s) => ({
        ...s,
        completedSlotIds: s.completedSlotIds.includes(slotId)
          ? s.completedSlotIds.filter((id) => id !== slotId)
          : [...s.completedSlotIds, slotId],
        waivedSlotIds: s.waivedSlotIds.filter((id) => id !== slotId), // completing clears waiver
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
      }));
    },
    [commit]
  );

  const resetPlan = useCallback(() => {
    snapshotsRef.current = {};
    commit(() => ({ ...EMPTY }));
  }, [commit]);

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      planId,
      planLoading,
      planError,
      assignSlot,
      clearSlot,
      toggleCompleted,
      toggleWaived,
      resetPlan,
    }),
    [
      state,
      planId,
      planLoading,
      planError,
      assignSlot,
      clearSlot,
      toggleCompleted,
      toggleWaived,
      resetPlan,
    ]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlanContext(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanContext must be used within PlanProvider");
  return ctx;
}
