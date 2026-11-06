/**
 * Exam credit tables (spec 025): Cornell's university Credit by Exam table, the
 * Arts & Sciences and CALS changes to it, and Engineering's own table.
 *
 * GENERATED DATA: 2026-27.json is written by scripts/build-credit-tables.ts from
 * saved copies of Cornell's pages. Don't edit the JSON by hand; re-run the script
 * (`npx tsx build-credit-tables.ts`, `--check` to verify) from scripts/.
 */
import type { ExamTables } from "@/lib/credit/types";
import tables2026 from "./2026-27.json";

export const EXAM_TABLES: ExamTables = tables2026 as ExamTables;
