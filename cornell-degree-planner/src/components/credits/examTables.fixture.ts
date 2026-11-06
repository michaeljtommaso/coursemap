/**
 * A small ExamTables for the credits editor's tests (independent of the
 * generated tables), plus resolver stand-ins that read it.
 */
import type { CreditCollege, ExamAward, ExamTables } from "@/lib/credit/types";

const AP = ["1", "2", "3", "4", "5"];
const IB = ["1", "2", "3", "4", "5", "6", "7"];
const SOURCE = { url: "https://example.edu/table", fetched: "2026-11-01" };

export const FIXTURE_TABLES: ExamTables = {
  year: "2026-27",
  exams: [
    { id: "ap-calculus-bc", family: "ap", name: "Calculus BC", scale: AP, common: true },
    { id: "ap-chemistry", family: "ap", name: "Chemistry", scale: AP, common: true },
    { id: "ap-art-history", family: "ap", name: "Art History", scale: AP },
    { id: "ap-latin", family: "ap", name: "Latin", scale: AP },
    { id: "ib-biology-hl", family: "ib", name: "Biology HL", scale: IB, common: true },
    { id: "alevel-mathematics", family: "alevel", name: "Mathematics", scale: ["E", "D", "C", "B", "A", "A*"] },
    { id: "intl-fr-mathematics", family: "intl", group: "French Baccalaureate", name: "Mathematics", scale: ["10", "12", "14", "16"] },
  ],
  university: {
    college: "university",
    year: "2026-27",
    source: SOURCE,
    awards: [
      { exam: "ap-calculus-bc", scores: ["4", "5"], courses: ["MATH-1110"], credits: 4 },
      {
        exam: "ap-chemistry",
        scores: ["5"],
        courses: ["CHEM-2070"],
        credits: 4,
        limits: ["Chemistry majors: elective credit only"],
      },
      { exam: "ap-art-history", scores: ["5"], courses: [], credits: 3 },
      { exam: "ib-biology-hl", scores: ["6", "7"], courses: ["BIOG-1440"], credits: 4 },
      { exam: "alevel-mathematics", scores: ["A", "A*"], courses: ["MATH-1110"], credits: 4 },
      { exam: "intl-fr-mathematics", scores: ["14", "16"], courses: ["MATH-1110"], credits: 4 },
    ],
  },
  overrides: {},
  engineering: {
    college: "engineering",
    year: "2026-27",
    source: SOURCE,
    awards: [
      { exam: "ap-calculus-bc", scores: ["5"], courses: ["MATH-1910"], credits: 4 },
    ],
  },
};

function tablesFor(tables: ExamTables) {
  return [tables.university, tables.engineering, ...Object.values(tables.overrides)].filter(Boolean);
}

/** Stand-in for lib/credit/resolve scoresThatEarn over the fixture. */
export function fixtureScoresThatEarn(exam: string, tables: ExamTables | null): string[] {
  if (!tables) return [];
  const def = tables.exams.find((e) => e.id === exam);
  const earning = new Set(
    tablesFor(tables).flatMap((t) => t!.awards.filter((a) => a.exam === exam).flatMap((a) => a.scores))
  );
  return (def?.scale ?? []).filter((s) => earning.has(s));
}

/** Stand-in for lib/credit/resolve examResult: engineering reads its own
 *  table, everyone else the university table. */
export function fixtureExamResult(
  exam: string,
  score: string,
  college: CreditCollege,
  tables: ExamTables | null
): (ExamAward & { limits: string[] }) | null {
  if (!tables) return null;
  const table = college === "engineering" ? tables.engineering : tables.university;
  const award = table.awards.find((a) => a.exam === exam && a.scores.includes(score));
  return award ? { ...award, limits: award.limits ?? [] } : null;
}
