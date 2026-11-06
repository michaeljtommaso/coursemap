/**
 * examDisplay (spec 028 D4/D6) — names, ordering, search and the one-line
 * result the credits editor prints for an exam. Pure.
 */
import type { CreditCollege, ExamAward, ExamDef, ExamFamily } from "@/lib/credit/types";
import { collegeShortName } from "@/lib/planner/colleges";

export const FAMILY_LABEL: Record<ExamFamily, string> = {
  ap: "AP",
  ib: "IB",
  alevel: "A-Level",
  intl: "Other",
};

/** Tab order (D4). */
export const FAMILY_ORDER: ExamFamily[] = ["ap", "ib", "alevel", "intl"];

/** "AP Calculus BC", "IB Biology HL", "French Baccalaureate Mathematics". */
export function examDisplayName(def: ExamDef): string {
  if (def.family === "intl") return def.group ? `${def.group} ${def.name}` : def.name;
  return `${FAMILY_LABEL[def.family]} ${def.name}`;
}

/** Common exams first (table order kept), then the rest by name. */
export function sortExams(exams: ExamDef[]): ExamDef[] {
  const common = exams.filter((e) => e.common);
  const rest = exams.filter((e) => !e.common).sort((a, b) => a.name.localeCompare(b.name));
  return [...common, ...rest];
}

/** Every word of the query appears in the exam's family, name or group. */
export function matchesQuery(def: ExamDef, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${FAMILY_LABEL[def.family]} ${examDisplayName(def)} ${def.group ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "Other" tab: exams grouped by national table, groups by name. */
export function groupIntl(exams: ExamDef[]): { group: string; exams: ExamDef[] }[] {
  const byGroup = new Map<string, ExamDef[]>();
  for (const e of exams) {
    const g = e.group ?? "Other exams";
    byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({ group, exams: sortExams(list) }));
}

/** "MATH-1910" → "MATH 1910". */
export function courseCode(id: string): string {
  return id.replace(/-/, " ");
}

export function collegePhrase(college: CreditCollege): string {
  return college ? `in ${collegeShortName(college)}` : "at this score";
}

/** The inline result on a picked row (D4/D7). */
export function awardSummary(award: ExamAward): string {
  const codes = award.courses.map(courseCode).join(" + ");
  if (award.placementOnly) return codes ? `Placement out of ${codes} · no credit` : "Placement only · no credit";
  const cr = `${formatCredits(award.credits)} cr`;
  return codes ? `${codes} · ${cr}` : `${cr} (no specific course)`;
}

export function noCreditText(college: CreditCollege): string {
  return `No credit ${collegePhrase(college)}`;
}

export function formatCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
