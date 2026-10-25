/**
 * colleges.ts (spec 019 D3/D11) — the colleges the app knows and the engine
 * family each program runs on.
 *
 * Two ideas that look alike and must stay apart:
 *  - COLLEGE (`CollegeId`) is who a student is ranked with: Major Match only
 *    compares majors inside the student's own college (D3).
 *  - FAMILY (`ProgramFamily`) is which engine evaluates a program: the
 *    Engineering engine (`assign()`, slot files) or the Distribution engine
 *    (layers, `solve()`). Info Science and Communication are CALS majors that
 *    stay on the Engineering engine until their CALS layers exist (Phase 5).
 */

export type CollegeId = "engineering" | "cas" | "cals";
export type ProgramFamily = "engineering" | "cas" | "cals";

export const COLLEGES: { id: CollegeId; name: string; shortName: string }[] = [
  { id: "engineering", name: "College of Engineering", shortName: "Engineering" },
  { id: "cas", name: "College of Arts and Sciences", shortName: "Arts & Sciences" },
  { id: "cals", name: "College of Agriculture and Life Sciences", shortName: "CALS" },
];

export function isCollegeId(v: unknown): v is CollegeId {
  return v === "engineering" || v === "cas" || v === "cals";
}

/** A program doc's display college ("College of Engineering") → its id; null
 *  for anything else (the blank canvas's "Your own plan"). */
export function collegeIdFromName(name: string | null | undefined): CollegeId | null {
  return COLLEGES.find((c) => c.name === name)?.id ?? null;
}

export function collegeShortName(id: CollegeId): string {
  return COLLEGES.find((c) => c.id === id)!.shortName;
}

/** Does this family run on the Distribution engine? */
export function isDistributionFamily(f: ProgramFamily | null | undefined): f is "cas" | "cals" {
  return f === "cas" || f === "cals";
}

/** The defaults every reader uses for a Program's spec 019 fields (types/db.ts
 *  Program: optional so old program docs and the synthetic blank still work). */
type ProgramLike = {
  college: string;
  collegeId?: CollegeId | null;
  family?: ProgramFamily;
  status?: "visible" | "hidden";
};

export function programFamily(p: ProgramLike | null | undefined): ProgramFamily {
  return p?.family ?? "engineering";
}

export function programCollegeId(p: ProgramLike | null | undefined): CollegeId | null {
  if (!p) return null;
  return p.collegeId !== undefined ? p.collegeId : collegeIdFromName(p.college);
}

/** Shown in the major picker? Hidden majors stay loadable for students
 *  already on them (spec 019 D11 / States table). */
export function programIsVisible(p: ProgramLike): boolean {
  return p.status !== "hidden";
}
