import type { CourseRule, DistCourse, Layer, PoolRow, Row } from "./types";

/**
 * search.testkit.ts — seeded generators shared by the Distribution engine's
 * brute-force cross-check tests. Test-only; nothing in the app imports it.
 */

/** mulberry32: a small deterministic PRNG, so every run checks the same cases. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

export type Rng = ReturnType<typeof rng>;

export const TAGS = ["A", "B", "C", "D"];
export const SUBJECTS = ["X", "Y", "Z"];

export function randomCourses(r: Rng, n: number, tagChance = 0.4): DistCourse[] {
  return Array.from({ length: n }, (_, k) => {
    const tags = TAGS.filter(() => r.chance(tagChance));
    const subject = r.pick(SUBJECTS);
    return {
      id: `${subject}-${1000 + k}`,
      subject,
      number: String(1000 + k),
      credits: r.int(1, 4),
      attrs: tags.map((value) => ({ value })),
    };
  });
}

/**
 * A 14-row major layer over a 48-course board: four seats, nine overlapping
 * subject/level/tag pools (one with a per-subject cap) and one catch-all pool
 * ("12 credits of anything except PE"). Every pool competes with several
 * others for most courses — the shape that stresses the layer search.
 */
export function randomMajorBoard(r: Rng): { layer: Layer; courses: DistCourse[] } {
  const subjects = ["ECON", "ECON", "ECON", "MATH", "STAT", "CS", "GOVT", "HIST", "PHIL", "ENGL", "PE"];
  const used = new Set<string>();
  const courses: DistCourse[] = [];
  while (courses.length < 48) {
    const subject = r.pick(subjects);
    const number = String(r.int(11, 49) * 100 + r.int(0, 9) * 10);
    const id = `${subject}-${number}`;
    if (used.has(id)) continue;
    used.add(id);
    courses.push({
      id,
      subject,
      number,
      credits: subject === "PE" ? 1 : r.chance(0.3) ? 4 : 3,
      attrs: r.chance(0.3) ? [{ value: "QUANT" }] : [],
    });
  }
  const source = { url: "https://example.edu", anchor: "x" };
  const pool = (id: string, rule: CourseRule, requiredCourses: number, requiredCredits: number, over: Partial<PoolRow> = {}): PoolRow => ({
    id,
    label: id,
    group: "Major",
    source,
    kind: "pool",
    rule,
    requiredCourses,
    requiredCredits,
    ...over,
  });
  const seat = (id: string): Row => ({
    id,
    label: id,
    group: "Core",
    source,
    kind: "seat",
    rule: { course: [r.chance(0.8) ? r.pick(courses).id : "NONE-1000"] },
  });
  const subj = (...s: string[]): CourseRule => ({ subject: s });
  const atLeast = (min: number): CourseRule => ({ number: { min } });
  const rows: Row[] = [
    seat("core1"),
    seat("core2"),
    seat("core3"),
    seat("core4"),
    pool("econ-upper", { allOf: [subj("ECON"), atLeast(3000)] }, 4, 12),
    pool("econ-stat", { allOf: [subj("ECON", "STAT"), atLeast(2000)] }, 3, 9),
    pool("advanced", { allOf: [subj("ECON", "GOVT", "HIST"), atLeast(4000)] }, 2, 6),
    pool("quant-math", subj("MATH", "STAT"), 2, 7),
    pool("computing", { allOf: [subj("CS", "MATH"), atLeast(2000)] }, 2, 6),
    pool("policy", subj("GOVT", "HIST", "ECON"), 3, 9, { maxPerSubject: 2 }),
    pool("humanities", subj("PHIL", "ENGL", "HIST"), 2, 6),
    pool("quant-tag", { tag: ["QUANT"] }, 2, 6),
    pool("outside", { allOf: [{ not: subj("ECON") }, atLeast(3000)] }, 2, 6),
    pool("free", { not: subj("PE") }, 0, 12),
  ];
  return {
    layer: { id: "major", kind: "major", family: "cas", name: "major", catalogYear: "2026-27", rows },
    courses,
  };
}

/**
 * A realistic major + `courseSharing: "separate"` concentration, shaped like
 * the largest authored layers (a 17-consuming-row major, a 12-row
 * concentration): seats and pools over short course lists, a few
 * subject/level pools and an upper-level electives pool, plus overlay and
 * confirm rows. The board has 50 courses, about two thirds in the major's
 * subjects. As in real catalogs, a board course sits in about one course
 * list (sometimes two) while the subject/level pools overlap everything; lists
 * also name courses the student has not taken. The two layers form one
 * counting group of 29 consuming rows.
 */
export function majorWithConcentrationBoard(r: Rng): { major: Layer; concentration: Layer; courses: DistCourse[] } {
  const plan: [string, number][] = [
    ["PHYS", 16],
    ["MATH", 8],
    ["ASTRO", 6],
    ["CS", 4],
    ["ENGL", 3],
    ["HIST", 3],
    ["PHIL", 3],
    ["ECON", 3],
    ["GOVT", 2],
    ["BIOG", 2],
  ];
  const used = new Set<string>();
  const courses: DistCourse[] = [];
  for (const [subject, n] of plan) {
    for (let k = 0; k < n; ) {
      const number = String(r.int(11, 49) * 100 + r.int(0, 9) * 10);
      const id = `${subject}-${number}`;
      if (used.has(id)) continue;
      used.add(id);
      courses.push({ id, subject, number, credits: r.chance(0.4) ? 4 : 3 });
      k++;
    }
  }
  const core = courses.filter((c) => ["PHYS", "MATH", "ASTRO", "CS"].includes(c.subject));
  // A shuffled deck of the major-subject courses: each list draws its board
  // courses from the deck (so lists rarely share one), pads with courses not on
  // the board, and now and then repeats a course another list already named.
  const deck = [...core];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let offBoard = 0;
  const list = (onBoard: number, size: number) => {
    const ids: string[] = [];
    for (let k = 0; k < onBoard; k++) {
      const c = r.chance(0.15) || deck.length === 0 ? r.pick(core) : (deck.pop() as DistCourse);
      ids.push(c.id);
    }
    while (ids.length < size) ids.push(`NONE-${1000 + offBoard++}`);
    return ids;
  };
  const source = { url: "https://example.edu", anchor: "x" };
  const base = (id: string) => ({ id, label: id, group: "G", source });
  const seat = (id: string): Row => ({ ...base(id), kind: "seat", rule: { course: list(1, r.int(1, 3)) } });
  const pool = (id: string, rule: CourseRule, requiredCourses: number, requiredCredits: number, over: Partial<PoolRow> = {}): PoolRow => ({
    ...base(id),
    kind: "pool",
    rule,
    requiredCourses,
    requiredCredits,
    ...over,
  });
  const subj = (...s: string[]): CourseRule => ({ subject: s });
  const level = (s: string[], min: number): CourseRule => ({ allOf: [subj(...s), { number: { min } }] });
  const confirm = (id: string): Row => ({ ...base(id), kind: "confirm" });
  // As authored (Physics, Astronomy, Computer Science): mostly seats over short
  // lists, a couple of list pools, and two or three broad subject/level pools
  // per layer, the concentration's overlapping the major's.
  const majorRows: Row[] = [
    ...Array.from({ length: 11 }, (_, k) => seat(`core${k}`)),
    ...Array.from({ length: 2 }, (_, k) => pool(`list${k}`, { course: list(r.int(2, 3), 6) }, 2, 0)),
    pool("lab", { course: list(r.int(1, 2), 4) }, 1, 0),
    pool("phys-upper", level(["PHYS"], 3000), 3, 9),
    pool("electives", level(["PHYS", "MATH", "ASTRO", "CS"], 2000), 3, 9),
    pool("outside", { allOf: [{ not: subj("PHYS") }, { number: { min: 3000 } }] }, 2, 6),
    pool("upper-any", { number: { min: 3000 } }, 6, 0, { overlay: true }),
    confirm("grades"),
    confirm("approval"),
  ];
  const concRows: Row[] = [
    ...Array.from({ length: 8 }, (_, k) => seat(`c-core${k}`)),
    ...Array.from({ length: 2 }, (_, k) => pool(`c-list${k}`, { course: list(r.int(2, 3), 6) }, 2, 0)),
    pool("c-adv-math", level(["MATH"], 3000), 2, 6),
    pool("c-extra", level(["PHYS", "ASTRO"], 3000), 0, 7),
    pool("c-upper", { number: { min: 3000 } }, 4, 0, { overlay: true }),
  ];
  const layer = (id: string, kind: Layer["kind"], rows: Row[], over: Partial<Layer> = {}): Layer => ({
    id,
    kind,
    family: "cas",
    name: id,
    catalogYear: "2026-27",
    programId: "p",
    rows,
    ...over,
  });
  return {
    major: layer("p", "major", majorRows),
    concentration: layer("p--c", "concentration", concRows, { concentrationId: "c", courseSharing: "separate" }),
    courses,
  };
}

const CALS_TAGS = ["BIO-AG", "CHPH-AG", "MQL-AG", "OPHLS-AG", "CA-AG", "FL-AG", "D-AG", "HA-AG", "KCM-AG", "LA-AG", "SBA-AG", "WRT-AG", "ORL-AG"];
const CALS_SUBJECTS = ["BIOEE", "BIOMG", "CHEM", "PHYS", "MATH", "ANSC", "NTRES", "ENGL", "HIST", "ECON", "COMM", "INFO", "NS"];

/**
 * A CALS-like board (50 courses, each CALS tag with probability 0.2, a few
 * "FWS:" titles) and a random 12-row major of seats, overlapping
 * subject-or-tag pools (some capped per subject) and small distributions —
 * meant to be solved under the real pre-2025 CALS college layer. Draws in the
 * same order as the external review's generator, so its seeds reproduce.
 */
export function calsPreMajorBoard(r: Rng): { major: Layer; courses: DistCourse[] } {
  const courses: DistCourse[] = Array.from({ length: 50 }, (_, k) => {
    const subject = r.pick(CALS_SUBJECTS);
    const tags = CALS_TAGS.filter(() => r.chance(0.2));
    const credits = r.int(1, 4);
    const title = r.chance(0.1) ? "FWS: Something" : "Course";
    const number = String(1100 + k);
    return { id: `${subject}-${number}`, subject, number, title, credits, attrs: tags.map((value) => ({ value })) };
  });
  const source = { url: "https://example.edu", anchor: "x" };
  const base = (id: string) => ({ id, label: id, group: "Major", source });
  const rows: Row[] = [];
  for (let k = 0; k < 12; k++) {
    const kind = r.int(0, 2);
    if (kind === 0) {
      rows.push({ ...base(`m${k}`), kind: "seat", rule: { anyOf: [{ tag: [r.pick(CALS_TAGS)] }, { subject: [r.pick(CALS_SUBJECTS)] }] } });
    } else if (kind === 1) {
      rows.push({
        ...base(`m${k}`),
        kind: "pool",
        rule: { anyOf: [{ subject: [r.pick(CALS_SUBJECTS), r.pick(CALS_SUBJECTS)] }, { tag: [r.pick(CALS_TAGS)] }] },
        requiredCourses: r.int(0, 3),
        requiredCredits: r.int(6, 18),
        ...(r.chance(0.3) ? { maxPerSubject: 2 } : {}),
      });
    } else {
      rows.push({
        ...base(`m${k}`),
        kind: "distribution",
        categories: CALS_TAGS.slice(0, 5).map((t) => ({ id: t, label: t, rule: { tag: [t] } })),
        requiredCourses: r.int(2, 4),
        minDistinctCategories: r.int(2, 3),
        maxCategoriesPerCourse: r.int(1, 2),
        maxDoubleCountCourses: 1,
      });
    }
  }
  return {
    major: { id: "major", kind: "major", family: "cals", name: "M", catalogYear: "2026-27", programId: "p", rows },
    courses,
  };
}

/** Every subset of `xs` (as arrays, in order). */
export function subsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}
