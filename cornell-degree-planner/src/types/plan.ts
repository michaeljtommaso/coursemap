/**
 * The course-placement plan model (spec 014 §D1/§D5; short terms spec 042 D3).
 *
 * A semester column is an ordered list of placements. A placement is one
 * course sitting at one position on the board — nothing else is drawn there
 * (no requirement containers, no template defaults). Requirements are
 * ATTRIBUTION, computed position-independently by majorMatch.
 *
 *   - `id`        — a placement id (uuid). Manual marks (completed / in
 *                   progress) key on it, so the same course placed twice
 *                   (a retake) can carry different marks.
 *   - `courseId`  — the course's dash-form id ("CS-2110").
 *   - `sem`       — the semester column, 1..10.
 *   - `order`     — the card's position within its column, DENSE 0..n-1
 *                   (placementOps keeps it that way after every edit).
 *   - `shortTerm` — spec 042: when `true`, the placement sits in the short
 *                   term (winter or summer) just BEFORE semester `sem`: a
 *                   Summer before a Fall, a Winter before a Spring. Absent on
 *                   every Fall/Spring placement — never `false` or
 *                   `undefined` (Firestore rejects undefined; omit the key).
 */
export type Placement = { id: string; courseId: string; sem: number; order: number; shortTerm?: true };

/**
 * A board column (spec 042 D3): semester `sem`, or — with `shortTerm` — the
 * short term just before it. lib/planner/terms.ts orders and labels these.
 */
export type ColumnRef = { sem: number; shortTerm?: boolean };
