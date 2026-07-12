// ─── Prerequisite expression tree ────────────────────────────────────────────
export type PrereqExpr =
  | { type: "and" | "or"; children: PrereqExpr[] }
  | { type: "course"; id: string }
  | { type: "pattern"; pattern: string }
  | { type: "concurrent"; id: string }
  // Spec 007 §3 decision 1 — "usually requires `expr`; `note` also satisfies
  // this." Emitted by the parser whenever noise-stripping would otherwise mint
  // a hard requirement out of a non-course alternative (e.g. "MATH 1910 or
  // equivalent AP credit" → advisory(course(MATH-1910), "or equivalent AP
  // credit")). Advisory NEVER blocks — evaluatePrereq/collectUnmetLeaves treat
  // it as always-satisfied; the UI does not yet render a distinct state for it
  // (deferred to a later unit).
  | { type: "advisory"; expr: PrereqExpr; note: string };

// ─── Elective qualifying rules ────────────────────────────────────────────────
export type QualifyingRule =
  | { type: "level"; subject: string; min_number: number }
  | { type: "category"; category: string }
  | { type: "outside"; exclude_subjects: string[] }
  | { type: "list" }
  | { type: "open" };

// ─── Course attribute (crseAttrs — spec 010 §1/§3, Unit 10A) ─────────────────
export type CourseAttr = { value: string; descr: string; group: string };

// ─── Course section (enrollGroups[].classSections[] — spec 010 §1/§3) ───────
// Active-roster-only snapshot: near-term rosters have rich sections, future
// terms simply have none. Pure data plumbing — no slot/requirement matching
// here (that's Unit 10B / spec 011).
export type CourseSection = {
  code: string; // `${component} ${section}`, e.g. "LEC 001"
  component: string;
  openStatus: string | null;
  gradingBasis: string | null;
  components: string[];
  instructors: Array<{ netid: string; firstName: string; lastName: string }>;
  meetings: Array<{ pattern: string; timeStart: string; timeEnd: string }>;
};

// ─── Row types matching Supabase tables ──────────────────────────────────────

export type Course = {
  id: string;
  subject: string;
  number: string;
  title: string;
  credits_min: number;
  credits_max: number;
  description: string | null;
  offered: string[];
  prereq_expr: PrereqExpr | null;
  coreq_expr: PrereqExpr | null;
  // Credit-exclusion course ids, self-stripped (spec 007 §5 / Unit 7D). Default
  // [] when the doc carries no forbiddenOverlaps. Consumed by computeSlotStatusMap
  // to derive the plan-wide overlap warning (spec 007 §1b/§5).
  forbidden_overlaps: string[];
  // Prereq prose the parser could not turn into a node — grade minimums,
  // permission-of-instructor asides, "high school math" branches (spec 007
  // §1b/§4). Default []. Surfaced as `docNotes` on the slot status (No-data-safe:
  // prose, never a hard block).
  prereq_notes: string[];
  // Distribution/requirement tags from crseAttrs (spec 010 §1/§3, Unit 10A).
  // Default []. Pure data plumbing — no requirement matching in this unit.
  attrs: CourseAttr[];
  // Per-section instructor/meeting/status data from enrollGroups, active-roster
  // snapshot only (spec 010 §1/§3). Default [].
  sections: CourseSection[];
  // componentsRequired from the first enroll group — course-level workload
  // signal, e.g. ["LEC","DIS"] (spec 010 §1/§3). Default [].
  components: string[];
  // ⚠️ NAMING TRAP (spec-002-era accident): roster_id is Cornell's NUMERIC
  // crseId ("358546"), NOT the roster slug — never compare it to "FA26".
  roster_id: string | null;
  // The roster SLUG the last sync ran against ("FA26") — the field the
  // time-horizon gates compare to enrollmentTarget (spec 012 near-face fix).
  // null on docs predating the fixed sync and on all display snapshots.
  roster: string | null;
  updated_at: string;
};

export type Program = {
  id: string;
  name: string;
  short_name: string;
  college: string;
  catalog_year: number;
  total_credits: number | null;
  affiliation_text: string | null;
  created_at: string;
};

export type ElectiveGroup = {
  id: string;
  program_id: string | null;
  name: string;
  description: string | null;
  qualifying_rule: QualifyingRule;
  min_credits: number;
  advisor_approval: boolean;
  notes: string | null;
};

// Single source of truth for the category union lives with its runtime
// companions (SLOT_CATEGORIES / CATEGORY_META) in lib/planner/slotCategory.
import type { SlotCategory } from "@/lib/planner/slotCategory";
export type { SlotCategory };

// Attribute-requirement match spec (spec 010 §2, Unit 10B) — lives with the
// satisfaction function it feeds so predicate shapes have one home.
import type { AttributeMatch } from "@/lib/planner/satisfies";
export type { AttributeMatch };

export type ProgramSlot = {
  id: string;
  program_id: string;
  // Spec 010 §2 — `attribute` slots match on course properties (title/attrs).
  kind: "course" | "pattern" | "elective" | "attribute";
  course_id: string | null;
  pattern: string | null;
  pattern_title: string | null;
  elective_group_id: string | null;
  suggested_semester: number;
  slot_row: number;
  // Slot category (spec 006 §D1) — the card's subject/role accent, or null when
  // the program doc predates the backfill.
  category: SlotCategory | null;
  // Attribute requirement's match spec (spec 010 §2) — present only on
  // `attribute` slots. Optional so synthetic/legacy slot literals need not carry
  // it; normalizeProgram always populates it (a value or null). Null = an
  // unmatchable requirement (malformed/absent match), never a crash.
  attribute_match?: AttributeMatch | null;
};

// Slot enriched with joined course / elective group data
export type ProgramSlotWithData = ProgramSlot & {
  courses: Course | null;
  elective_groups: ElectiveGroup | null;
};

// SlotEdge (authored prereq wires) RETIRED — spec 008 §2b. The canvas derives
// its edges from placed courses' prereq/coreq trees now (DerivedEdge in
// lib/planner/deriveEdges.ts); there is no authored-edge type anymore.

// ─── UI status ───────────────────────────────────────────────────────────────
export type NodeStatus = "available" | "completed" | "waived";
