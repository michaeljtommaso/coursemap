import { describe, it, expect } from "vitest";
import { evaluateRow, makeEnv, relevantTo, type EvalRow, type Evaluation } from "./evaluateRow";
import { solveLayers } from "./engine";
import { searchGroup } from "./search";
import { randomCourses, rng, TAGS, type Rng } from "./search.testkit";
import type { DistCourse, Layer, Row } from "./types";

/**
 * The layer search must find the lexicographic optimum (rows met, then the
 * sum of fractions) of every assignment of courses to rows. Checked against
 * exhaustive enumeration on seeded instances, including boards with identical
 * courses (the symmetry-breaking path) and rows of every consuming kind.
 */

const source = { url: "https://example.edu", anchor: "x" };
const base = (id: string) => ({ id, label: id, group: "g", source });

function randomRow(r: Rng, id: string, depth = 0): EvalRow {
  const tags = TAGS.filter(() => r.chance(0.5));
  const rule = { tag: tags.length ? tags : [r.pick(TAGS)] };
  const kind = depth === 0 ? r.int(0, 3) : r.int(0, 1);
  if (kind === 0) return { ...base(id), kind: "seat", rule };
  if (kind === 1) {
    return {
      ...base(id),
      kind: "pool",
      rule,
      requiredCourses: r.int(1, 3),
      requiredCredits: r.int(0, 8),
      ...(r.chance(0.3) ? { maxPerSubject: 1 } : {}),
    };
  }
  if (kind === 2) {
    return {
      ...base(id),
      kind: "distribution",
      categories: TAGS.slice(0, 3).map((t) => ({ id: t, label: t, rule: { tag: [t] } })),
      requiredCourses: r.int(1, 3),
      minDistinctCategories: r.int(1, 3),
      maxCategoriesPerCourse: r.int(1, 2),
      ...(r.chance(0.5) ? { maxDoubleCountCourses: 1 } : {}),
    };
  }
  return { ...base(id), kind: "anyOf", rows: [randomRow(r, `${id}a`, 1), randomRow(r, `${id}b`, 1)] as never };
}

function withDuplicates(r: Rng, courses: DistCourse[]): DistCourse[] {
  const out = [...courses];
  for (const c of courses) {
    if (r.chance(0.35)) out.push({ ...c, id: `${c.subject}-${9000 + out.length}`, number: String(9000 + out.length) });
  }
  return out.slice(0, 7);
}

function bruteForce(rows: EvalRow[], courses: DistCourse[]) {
  const env = makeEnv(courses, {});
  const all = courses.map((_, i) => i);
  const memo = new Map<string, Evaluation>();
  const evalSet = (r: number, set: number[]) => {
    const key = `${r}:${set.join(",")}`;
    let ev = memo.get(key);
    if (!ev) {
      ev = evaluateRow(rows[r], { offered: set, all }, env);
      memo.set(key, ev);
    }
    return ev;
  };
  const options = all.map((c) => [-1, ...rows.map((_, r) => r).filter((r) => relevantTo(rows[r], c, env))]);
  let best = { met: -1, frac: -1 };
  const sets: number[][] = rows.map(() => []);
  const walk = (i: number) => {
    if (i === all.length) {
      let met = 0;
      let frac = 0;
      rows.forEach((_, r) => {
        const ev = evalSet(r, sets[r]);
        if (ev.met) met++;
        frac += ev.fraction;
      });
      if (met > best.met || (met === best.met && frac > best.frac + 1e-9)) best = { met, frac };
      return;
    }
    for (const r of options[i]) {
      if (r >= 0) sets[r].push(i);
      walk(i + 1);
      if (r >= 0) sets[r].pop();
    }
  };
  walk(0);
  return best;
}

describe("searchGroup = exhaustive enumeration", () => {
  it("200 seeded instances, with identical courses", () => {
    const r = rng(31);
    for (let t = 0; t < 200; t++) {
      const courses = withDuplicates(r, randomCourses(r, r.int(1, 5), 0.5));
      const rows = Array.from({ length: r.int(2, 4) }, (_, k) => randomRow(r, `r${k}`));
      const env = makeEnv(courses, {});
      const out = searchGroup(rows, courses.map((_, i) => i), 200_000, env, undefined, undefined, 0);
      const met = out.evals.filter((e) => e.met).length;
      const frac = out.evals.reduce((a, e) => a + e.fraction, 0);
      const want = bruteForce(rows, courses);
      const ctx = `case ${t}: ${JSON.stringify({ rows, courses })}`;
      expect(out.capped, ctx).toBe(false);
      expect(met, ctx).toBe(want.met);
      expect(frac, ctx).toBeCloseTo(want.frac, 9);
      // Each course is counted by at most one row of the group.
      const counted = out.evals.flatMap((e) => e.counted);
      expect(new Set(counted).size, ctx).toBe(counted.length);
    }
  });

  it("120 seeded catch-all shapes (credit pools + one broad pool) — the joint bounds stay exact", () => {
    const r = rng(37);
    const subjects = ["ECON", "MATH", "STAT", "PE"];
    for (let t = 0; t < 120; t++) {
      const courses: DistCourse[] = Array.from({ length: r.int(4, 7) }, (_, k) => {
        const subject = r.pick(subjects);
        return { id: `${subject}-${1000 + k}`, subject, number: String(r.int(1, 4) * 1000 + k), credits: r.int(1, 4) };
      });
      const rows: EvalRow[] = [];
      if (r.chance(0.6)) rows.push({ ...base("seat"), kind: "seat", rule: { course: [r.pick(courses).id] } });
      for (let k = 0; k < r.int(2, 3); k++) {
        const subs = subjects.filter(() => r.chance(0.5));
        rows.push({
          ...base(`pool${k}`),
          kind: "pool",
          rule: subs.length ? { subject: subs } : { number: { min: 2000 } },
          requiredCourses: r.int(1, 3),
          requiredCredits: r.int(2, 8),
          ...(r.chance(0.2) ? { maxPerSubject: 1 } : {}),
        });
      }
      rows.push({ ...base("free"), kind: "pool", rule: { not: { subject: ["PE"] } }, requiredCourses: 0, requiredCredits: r.int(3, 9) });
      const env = makeEnv(courses, {});
      const out = searchGroup(rows, courses.map((_, i) => i), 200_000, env, undefined, undefined, 0);
      const want = bruteForce(rows, courses);
      const ctx = `case ${t}: ${JSON.stringify({ rows, courses })}`;
      expect(out.capped, ctx).toBe(false);
      expect(out.evals.filter((e) => e.met).length, ctx).toBe(want.met);
      expect(out.evals.reduce((a, e) => a + e.fraction, 0), ctx).toBeCloseTo(want.frac, 9);
    }
  });

  it("150 seeded distribution-heavy shapes (several distributions sharing categories) — the joint bounds stay exact", () => {
    const r = rng(41);
    for (let t = 0; t < 150; t++) {
      const courses = randomCourses(r, r.int(4, 6), 0.45);
      const rows: EvalRow[] = Array.from({ length: r.int(2, 4) }, (_, k) => {
        const maxCat = r.int(1, 2);
        return {
          ...base(`d${k}`),
          kind: "distribution",
          categories: TAGS.slice(0, 3).map((tg) => ({ id: tg, label: tg, rule: { tag: [tg] } })),
          requiredCourses: r.int(1, 2),
          minDistinctCategories: r.int(2, 3),
          maxCategoriesPerCourse: maxCat,
          ...(maxCat > 1 && r.chance(0.6) ? { maxDoubleCountCourses: r.int(0, 1) } : {}),
        };
      });
      if (r.chance(0.5)) rows.push({ ...base("seat"), kind: "seat", rule: { tag: [r.pick(TAGS)] } });
      const env = makeEnv(courses, {});
      const out = searchGroup(rows, courses.map((_, i) => i), 200_000, env, undefined, undefined, 0);
      const want = bruteForce(rows, courses);
      const ctx = `case ${t}: ${JSON.stringify({ rows, courses })}`;
      expect(out.capped, ctx).toBe(false);
      expect(out.evals.filter((e) => e.met).length, ctx).toBe(want.met);
      expect(out.evals.reduce((a, e) => a + e.fraction, 0), ctx).toBeCloseTo(want.frac, 9);
    }
  });

  it("250 seeded major + separate-concentration boards: the engine's group search equals enumeration over both layers' rows", () => {
    const r = rng(43);
    let stricter = 0;
    for (let t = 0; t < 250; t++) {
      const courses = withDuplicates(r, randomCourses(r, r.int(2, 5), 0.5));
      const majorRows = Array.from({ length: r.int(1, 3) }, (_, k) => randomRow(r, `m${k}`));
      const concRows = Array.from({ length: r.int(1, 2) }, (_, k) => randomRow(r, `c${k}`));
      const second = r.chance(0.3) ? [randomRow(r, "d0")] : [];
      const layer = (id: string, kind: Layer["kind"], rows: EvalRow[], over: Partial<Layer> = {}): Layer => ({
        id,
        kind,
        family: "cas",
        name: id,
        catalogYear: "2026-27",
        programId: "p",
        rows: rows as Row[],
        ...over,
      });
      const layers = [
        layer("M", "major", majorRows),
        layer("M--c", "concentration", concRows, { concentrationId: "c", courseSharing: "separate" }),
        ...(second.length ? [layer("M--d", "concentration", second, { concentrationId: "d", courseSharing: "separate" })] : []),
      ];
      const res = solveLayers({ layers, courses, ctx: { programId: "p" } });
      const results = res.layers.flatMap((l) => l.rows);
      const met = results.filter((x) => x.status === "met").length;
      const frac = results.reduce((a, x) => a + x.fraction, 0);
      const want = bruteForce([...majorRows, ...concRows, ...second], courses);
      const ctx = `case ${t}: ${JSON.stringify({ layers, courses })}`;
      expect(res.capped, ctx).toBe(false);
      expect(met, ctx).toBe(want.met);
      expect(frac, ctx).toBeCloseTo(want.frac, 9);
      // A course counts at most once across the group's (top-level) rows.
      const counted = results.flatMap((x) => x.courses.map((c) => c.courseId));
      expect(new Set(counted).size, ctx).toBe(counted.length);
      expect(res.layers.map((l) => l.layerId), ctx).toEqual(layers.map((l) => l.id));

      // Control: the same layers shared are independent — the optimum is each
      // layer's own enumeration, summed.
      const shared = solveLayers({ layers: layers.map((l) => ({ ...l, courseSharing: undefined })), courses, ctx: { programId: "p" } });
      const sharedRows = shared.layers.flatMap((l) => l.rows);
      const parts = [majorRows, concRows, second].filter((rows) => rows.length > 0).map((rows) => bruteForce(rows, courses));
      expect(sharedRows.filter((x) => x.status === "met").length, ctx).toBe(parts.reduce((a, p) => a + p.met, 0));
      expect(sharedRows.reduce((a, x) => a + x.fraction, 0), ctx).toBeCloseTo(
        parts.reduce((a, p) => a + p.frac, 0),
        9
      );
      if (want.met < parts.reduce((a, p) => a + p.met, 0)) stricter++;
    }
    // Non-vacuous: on many boards the group meets fewer rows than shared layers.
    expect(stricter).toBeGreaterThan(40);
  });

  it("identical courses over identical rows stay small (symmetry breaking)", () => {
    const courses: DistCourse[] = Array.from({ length: 12 }, (_, k) => ({
      id: `X-${k}`,
      subject: "X",
      number: String(k),
      credits: 3,
      attrs: [{ value: "A" }],
    }));
    const rows: EvalRow[] = Array.from({ length: 7 }, (_, k) => ({
      ...base(`p${k}`),
      kind: "pool",
      rule: { tag: ["A"] },
      requiredCourses: 2,
      requiredCredits: 0,
    }));
    const out = searchGroup(rows, courses.map((_, i) => i), 200_000, makeEnv(courses, {}));
    expect(out.capped).toBe(false);
    expect(out.evals.filter((e) => e.met)).toHaveLength(6);
    expect(out.nodes).toBeLessThan(20_000);
  });
});
