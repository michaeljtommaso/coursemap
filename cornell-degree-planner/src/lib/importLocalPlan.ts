import type { CreatePlanInput } from "@/services/plans";

/**
 * localStorage → cloud-plan import (docs/specs/002 §7) — RETIRED by spec 014.
 *
 * The pre-Firebase localStorage payload (`cornell-planner-v2`) holds the old
 * SLOT-model plan shape. Spec 014 §D5 replaced that model with course
 * placements and, with no real users or saved plans, chose NO conversion — so
 * there is nothing to import any more: readLocalPlanForImport() always returns
 * null, and AuthProvider simply marks the profile importedLocalPlan:true. A
 * fresh user gets an auto-created plan with the program's starting board.
 *
 * captureLocalPlanSnapshot / clearCapturedLocalPlan keep their exports so
 * main.tsx and AuthProvider keep their call sites; they no longer read
 * localStorage (the old payload is left untouched there).
 */

let captured = false;

/** Boot hook (main.tsx). Kept for its call site; no payload is read. */
export function captureLocalPlanSnapshot(): void {
  captured = true;
}

/** Post-import hook (AuthProvider). Kept for its call site. */
export function clearCapturedLocalPlan(): void {
  captured = true;
}

/** Always null: the old slot-model payload is not imported (spec 014 §D5). */
export function readLocalPlanForImport(): CreatePlanInput | null {
  if (!captured) captureLocalPlanSnapshot();
  return null;
}
