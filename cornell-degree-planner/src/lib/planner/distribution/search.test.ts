import { describe, it, expect } from "vitest";
import { evaluateRow, makeEnv, relevantTo, type EvalRow, type Evaluation } from "./evaluateRow";
import { searchGroup } from "./search";
import { randomCourses, rng, TAGS, type Rng } from "./search.testkit";
import type { DistCourse } from "./types";

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
      const out = searchGroup(rows, courses.map((_, i) => i), 200_000, env);
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
