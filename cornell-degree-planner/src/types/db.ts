// ─── Prerequisite expression tree ────────────────────────────────────────────
export type PrereqExpr =
  | { type: "and" | "or"; children: PrereqExpr[] }
  | { type: "course"; id: string }
  | { type: "pattern"; pattern: string }
  | { type: "concurrent"; id: string };

// ─── Elective qualifying rules ────────────────────────────────────────────────
export type QualifyingRule =
  | { type: "level"; subject: string; min_number: number }
  | { type: "category"; category: string }
  | { type: "outside"; exclude_subjects: string[] }
  | { type: "list" }
  | { type: "open" };

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
  roster_id: string | null;
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

export type ProgramSlot = {
  id: string;
  program_id: string;
  kind: "course" | "pattern" | "elective";
  course_id: string | null;
  pattern: string | null;
  pattern_title: string | null;
  elective_group_id: string | null;
  suggested_semester: number;
  slot_row: number;
  // Slot category (spec 006 §D1) — the card's subject/role accent, or null when
  // the program doc predates the backfill.
  category: SlotCategory | null;
};

// Slot enriched with joined course / elective group data
export type ProgramSlotWithData = ProgramSlot & {
  courses: Course | null;
  elective_groups: ElectiveGroup | null;
};

export type SlotEdge = {
  id: string;
  program_id: string;
  from_slot: string;
  to_slot: string;
  edge_type: "prereq" | "coreq" | "concurrent";
};

// ─── UI status ───────────────────────────────────────────────────────────────
export type NodeStatus = "available" | "completed" | "waived";
