/**
 * Slot category (spec 006 §D1) — a small, shared taxonomy layered onto program
 * slots so a card can carry a subject/role accent (math vs science vs
 * engineering core vs elective …) independent of its prereq/status state.
 *
 * The category is REAL DATA on the slot (backfilled per major from the official
 * flowcharts, see scripts/backfill-slot-categories.ts), not derived at render
 * time — a slot with no stored category renders exactly as before (null accent).
 * The derivation used by the backfill script lives here too (`deriveSlotCategory`)
 * so the app, the backfill, and the unit tests share one source of truth.
 *
 * Encoding decision (spec 006 §D1): category = a color accent + a tiny tag on the
 * card, NEVER a geometric shape — shapes would break the uniform card grid, the
 * drag ghost, and drop targets. Color families live in tokens.css (both themes)
 * and are mapped to Tailwind classes below so no class name is constructed at
 * runtime (Tailwind's content scanner sees them literally in CATEGORY_META).
 */

/** The finalized, small, cross-major set (spec 006 §D1). `core` covers the
 *  engineering common-curriculum + major courses (ENGRI/ENGRD/CS/major-subject);
 *  the flowchart legend's saturated status hues are deliberately NOT reused. */
export const SLOT_CATEGORIES = [
  "math",
  "science",
  "core",
  "liberal",
  "elective",
  "fws",
  "pe",
] as const;

export type SlotCategory = (typeof SLOT_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(SLOT_CATEGORIES);

/** Validate/normalize a stored value to the enum, or null. Case-insensitive so a
 *  seed that wrote "Math" still resolves; anything unknown degrades to null (the
 *  card renders as it did pre-D1). The one place the app trusts stored category. */
export function normalizeCategory(raw: unknown): SlotCategory | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return CATEGORY_SET.has(v) ? (v as SlotCategory) : null;
}

/** Display metadata per category: a short tag label + the literal Tailwind
 *  classes for the accent (text + faint tint background). Kept as literal strings
 *  so Tailwind's purge sees every class; the color values live in tokens.css. */
export const CATEGORY_META: Record<
  SlotCategory,
  { label: string; tag: string; dot: string; text: string; tint: string }
> = {
  math: { label: "Math", tag: "Math", dot: "bg-cat-math", text: "text-cat-math", tint: "bg-cat-math-tint" },
  science: { label: "Science", tag: "Science", dot: "bg-cat-science", text: "text-cat-science", tint: "bg-cat-science-tint" },
  core: { label: "Engineering", tag: "Eng", dot: "bg-cat-core", text: "text-cat-core", tint: "bg-cat-core-tint" },
  liberal: { label: "Liberal studies", tag: "Liberal", dot: "bg-cat-liberal", text: "text-cat-liberal", tint: "bg-cat-liberal-tint" },
  elective: { label: "Elective", tag: "Elective", dot: "bg-cat-elective", text: "text-cat-elective", tint: "bg-cat-elective-tint" },
  fws: { label: "Writing seminar", tag: "FWS", dot: "bg-cat-fws", text: "text-cat-fws", tint: "bg-cat-fws-tint" },
  pe: { label: "Phys ed", tag: "PE", dot: "bg-cat-pe", text: "text-cat-pe", tint: "bg-cat-pe-tint" },
};

// ── Backfill derivation (pure; shared with scripts/backfill-slot-categories.ts) ──

/** Natural-science subjects (physics / chemistry / biology / earth science).
 *  Everything engineering (ENGRI/ENGRD/CS/ECE/MAE/…/AEP/BEE/CHEME/ORIE/INFO)
 *  falls through to null; deriveSlotCategory (backfill) defaults that to `core`. */
export const SCIENCE_SUBJECTS = new Set([
  "PHYS", "CHEM", "BIO", "BIOG", "BIOMG", "BIOEE", "BIONB", "BIOMI", "BIOAP",
  "EAS", "ASTRO", "STSCI", "NTRES", "PLBIO", "NS", "BIOSM",
]);

const FWS_SUBJECTS = new Set(["FWIS", "FWS", "WRIT"]);
const PE_SUBJECTS = new Set(["PE", "PHYED"]);

/** Map a course/pattern subject prefix to a category, or null when the subject
 *  gives no confident signal — "core" means engineering, and an arbitrary
 *  directory subject (HADM, MUSIC, …) must NOT get tagged "Eng". Contexts that
 *  want the old engineering-default behavior (the per-major backfill, whose
 *  slots really are engineering curricula) apply `?? "core"` themselves. */
export function subjectCategory(subject: string): SlotCategory | null {
  const s = subject.trim().toUpperCase();
  if (s === "MATH") return "math";
  if (SCIENCE_SUBJECTS.has(s)) return "science";
  if (FWS_SUBJECTS.has(s)) return "fws";
  if (PE_SUBJECTS.has(s)) return "pe";
  return null;
}

/** The subject token of a courseId ("MATH-1910" → "MATH") or a pattern
 *  ("CS-111x" → "CS", "FWIS-1xxx" → "FWIS"). */
function subjectOf(idOrPattern: string): string {
  return (idOrPattern.split("-")[0] ?? "").toUpperCase();
}

export type DerivableSlot = {
  kind: "course" | "pattern" | "elective" | string;
  courseId?: string | null;
  pattern?: string | null;
  electiveGroupId?: string | null;
};

/** Does an elective group represent liberal studies rather than a free/technical
 *  elective? True when the group id or its qualifyingRule.category names it. */
export function groupIsLiberal(group: {
  id?: string;
  qualifyingRule?: { type?: string; category?: string } | null;
} | null | undefined): boolean {
  if (!group) return false;
  const cat = group.qualifyingRule?.category?.toLowerCase() ?? "";
  const id = group.id?.toLowerCase() ?? "";
  return cat.includes("liberal") || id.includes("liberal");
}

/** Derive a slot's category from its shape + (for electives) its group. Pure and
 *  deterministic — the backfill script runs this over every slot of all 13
 *  majors. Course/pattern slots derive from their subject; elective slots split
 *  into liberal vs (technical/free) elective. */
export function deriveSlotCategory(
  slot: DerivableSlot,
  group?: { id?: string; qualifyingRule?: { type?: string; category?: string } | null } | null
): SlotCategory {
  if (slot.kind === "elective") {
    return groupIsLiberal(group) ? "liberal" : "elective";
  }
  // Backfill context: these slots belong to engineering majors, so an
  // unrecognized subject (ENGRI/ENGRD/CS/major-subject/…) IS the eng core.
  if (slot.kind === "pattern" && slot.pattern) {
    return subjectCategory(subjectOf(slot.pattern)) ?? "core";
  }
  if (slot.kind === "course" && slot.courseId) {
    return subjectCategory(subjectOf(slot.courseId)) ?? "core";
  }
  return "core";
}
