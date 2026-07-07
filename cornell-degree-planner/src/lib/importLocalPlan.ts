import type { CreatePlanInput } from "@/services/plans";

/**
 * localStorage → cloud-plan import (docs/specs/002 §7).
 *
 * On first authed boot, if the old `cornell-planner-v2` payload exists and the
 * profile's importedLocalPlan != true, transform it into a plan doc:
 *   slotSelections / completedSlotIds / waivedSlotIds  → same fields
 *   selectedCourses (Record<id, Course>)               → courseSnapshots (display)
 * The programId comes from the old `cornell-program-v2` store (selectedProgramId).
 * localStorage is left INTACT afterward (rollback safety) but we stop reading it.
 *
 * Returns null when there's nothing importable (no payload, empty plan, or no
 * real program selected) — a fresh user simply auto-creates a plan on program
 * pick instead.
 */

const PLANNER_KEY = "cornell-planner-v2";
const PROGRAM_KEY = "cornell-program-v2";

/**
 * Captured raw localStorage snapshot, taken BEFORE any Zustand store rehydrates.
 * usePlannerStore now persists under `cornell-planner-v2` at version 2 and its
 * migrate strips the old plan-data keys — so if we read localStorage lazily
 * (after the store rehydrates) the plan payload would already be gone. Capturing
 * it synchronously at app entry (main.tsx → captureLocalPlanSnapshot) decouples
 * the import from store-rehydration order. The strings are left in localStorage
 * intact; we just hold our own copy of what they were at boot.
 */
let capturedPlanner: string | null = null;
let capturedProgram: string | null = null;
let captured = false;

export function captureLocalPlanSnapshot(): void {
  if (captured) return;
  captured = true;
  try {
    capturedPlanner = localStorage.getItem(PLANNER_KEY);
    capturedProgram = localStorage.getItem(PROGRAM_KEY);
  } catch {
    capturedPlanner = null;
    capturedProgram = null;
  }
}

type OldCourse = {
  id?: string;
  subject?: string;
  number?: string;
  title?: string;
  credits_min?: number;
  credits_max?: number;
};

type PersistEnvelope<T> = { state?: T; version?: number } | T;

function parsePersisted<T>(raw: string | null): T | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistEnvelope<T>;
    // Zustand persist wraps as { state, version }; tolerate a bare object too.
    if (parsed && typeof parsed === "object" && "state" in parsed) {
      return (parsed as { state?: T }).state ?? null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function readLocalPlanForImport(): CreatePlanInput | null {
  // Prefer the captured-at-boot snapshot; fall back to a live read (e.g. tests).
  if (!captured) captureLocalPlanSnapshot();

  const planner = parsePersisted<{
    slotSelections?: Record<string, string>;
    selectedCourses?: Record<string, OldCourse>;
    completedSlotIds?: string[];
    waivedSlotIds?: string[];
  }>(capturedPlanner);
  if (!planner) return null;

  const program = parsePersisted<{ selectedProgramId?: string | null }>(
    capturedProgram
  );
  const programId = program?.selectedProgramId ?? null;

  // A custom template (custom-*) has no Firestore program doc; don't import it
  // as a real plan. A missing/empty program means there's nothing to attach to.
  if (!programId || programId.startsWith("custom-")) return null;

  const slotSelections = planner.slotSelections ?? {};
  const completedSlotIds = planner.completedSlotIds ?? [];
  const waivedSlotIds = planner.waivedSlotIds ?? [];
  const selectedCourses = planner.selectedCourses ?? {};

  // Nothing meaningful to preserve → skip (fresh users just auto-create).
  const hasContent =
    Object.keys(slotSelections).length > 0 ||
    completedSlotIds.length > 0 ||
    waivedSlotIds.length > 0;
  if (!hasContent) return null;

  // selectedCourses (full Course) → courseSnapshots (display fields only), the
  // same denormalization discipline the plan doc uses everywhere else.
  const courseSnapshots: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(selectedCourses)) {
    courseSnapshots[id] = {
      id: c.id ?? id,
      subject: c.subject ?? "",
      number: c.number ?? "",
      title: c.title ?? id,
      creditsMin: c.credits_min ?? 0,
      creditsMax: c.credits_max ?? c.credits_min ?? 0,
    };
  }

  return {
    name: "Imported plan",
    programId,
    slotSelections,
    completedSlotIds,
    waivedSlotIds,
    courseSnapshots,
  };
}
