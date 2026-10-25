import { describe, it, expect } from "vitest";
import { evaluateRow, makeEnv } from "./evaluateRow";
import { courseMatchesRule } from "./rules";
import { randomCourses, rng, subsets, TAGS, type Rng } from "./search.testkit";
import type { CourseRule, CreditsRow, DistCourse, DistributionRow, PoolRow, RowLimit } from "./types";

/**
 * Brute-force cross-checks: on hundreds of small seeded instances, each
 * evaluator's verdict (met, fraction, and its tie-break) must equal the best
 * found by enumerating every legal subset or category assignment, and the
 * counted set it reports must itself be legal.
 */

const EPS = 1e-9;
const source = { url: "https://example.edu", anchor: "x" };
const matches = (c: DistCourse, rule: CourseRule) => courseMatchesRule(c, rule);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function randomRule(r: Rng): CourseRule {
  const tags = TAGS.filter(() => r.chance(0.5));
  return { tag: tags.length ? tags : [r.pick(TAGS)] };
}

function randomLimits(r: Rng): RowLimit[] {
  return Array.from({ length: r.int(0, 2) }, () => {
    const lim: RowLimit = { rule: { tag: [r.pick(TAGS)] } };
    if (r.chance(0.3)) lim.minCourses = r.int(1, 2);
    if (r.chance(0.3)) lim.maxCourses = r.int(0, 2);
    if (r.chance(0.3)) lim.minCredits = r.int(1, 5);
    if (r.chance(0.3)) lim.maxCredits = r.int(2, 6);
    return lim;
  });
}

type SubsetSpec = { reqCourses: number; reqCredits: number; maxPerSubject?: number; limits: RowLimit[] };

/** Legal (hard caps hold), fraction per the documented formula, met. */
function judge(set: DistCourse[], spec: SubsetSpec) {
  const bySubject = new Map<string, number>();
  for (const c of set) bySubject.set(c.subject, (bySubject.get(c.subject) ?? 0) + 1);
  let legal = [...bySubject.values()].every((n) => n <= (spec.maxPerSubject ?? Infinity));
  const parts: number[] = [];
  let met = set.length >= spec.reqCourses && sum(set.map((c) => c.credits)) >= spec.reqCredits;
  if (spec.reqCourses > 0) parts.push(Math.min(1, set.length / spec.reqCourses));
  if (spec.reqCredits > 0) parts.push(Math.min(1, sum(set.map((c) => c.credits)) / spec.reqCredits));
  for (const lim of spec.limits) {
    const inLim = set.filter((c) => matches(c, lim.rule));
    const n = inLim.length;
    const cr = sum(inLim.map((c) => c.credits));
    if (lim.maxCourses != null && n > lim.maxCourses) legal = false;
    if (lim.maxCredits != null && cr > lim.maxCredits) legal = false;
    if ((lim.minCourses ?? 0) > 0) parts.push(Math.min(1, n / (lim.minCourses as number)));
    if ((lim.minCredits ?? 0) > 0) parts.push(Math.min(1, cr / (lim.minCredits as number)));
    if (n < (lim.minCourses ?? 0) || cr < (lim.minCredits ?? 0)) met = false;
  }
  return { legal, met, fraction: met ? 1 : parts.length ? sum(parts) / parts.length : 1 };
}

describe("pool evaluator = brute force", () => {
  it("400 seeded instances", () => {
    const r = rng(19);
    for (let t = 0; t < 400; t++) {
      const courses = randomCourses(r, r.int(0, 8));
      const row: PoolRow = {
        id: "p",
        label: "p",
        group: "g",
        source,
        kind: "pool",
        rule: randomRule(r),
        requiredCourses: r.int(0, 4),
        requiredCredits: r.int(0, 10),
        ...(r.chance(0.4) ? { maxPerSubject: r.int(1, 2) } : {}),
        limits: randomLimits(r),
      };
      const spec: SubsetSpec = { reqCourses: row.requiredCourses, reqCredits: row.requiredCredits, maxPerSubject: row.maxPerSubject, limits: row.limits ?? [] };
      const env = makeEnv(courses, {});
      const all = courses.map((_, i) => i);
      const ev = evaluateRow(row, { offered: all, all }, env);

      const cands = courses.filter((c) => matches(c, row.rule));
      const judged = subsets(cands).map((s) => ({ s, ...judge(s, spec) })).filter((j) => j.legal);
      const bestF = Math.max(...judged.map((j) => j.fraction));
      const fewest = Math.min(...judged.filter((j) => j.fraction > bestF - EPS).map((j) => j.s.length));
      const mine = judge(ev.counted.map((i) => courses[i]), spec);

      const ctx = `case ${t}: ${JSON.stringify({ row, courses })}`;
      expect(ev.exact, ctx).toBe(true);
      expect(mine.legal, ctx).toBe(true);
      expect(ev.met, ctx).toBe(judged.some((j) => j.met));
      expect(ev.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(mine.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(ev.counted.length, ctx).toBe(fewest);
      expect(ev.progress.coursesHave).toBe(ev.counted.length);
      expect(ev.progress.creditsHave).toBe(sum(ev.counted.map((i) => courses[i].credits)));
    }
  });
});

describe("credits evaluator = brute force", () => {
  it("300 seeded instances (with sameSubject)", () => {
    const r = rng(23);
    for (let t = 0; t < 300; t++) {
      const courses = randomCourses(r, r.int(0, 8));
      const row: CreditsRow = {
        id: "c",
        label: "c",
        group: "g",
        source,
        kind: "credits",
        rule: randomRule(r),
        requiredCredits: r.int(0, 12),
        sameSubject: r.chance(0.4),
        limits: randomLimits(r),
      };
      const spec: SubsetSpec = { reqCourses: 0, reqCredits: row.requiredCredits, limits: row.limits ?? [] };
      const env = makeEnv(courses, {});
      const all = courses.map((_, i) => i);
      const ev = evaluateRow(row, { offered: [], all }, env);

      const cands = courses.filter((c) => matches(c, row.rule));
      const pools = row.sameSubject ? [...new Set(cands.map((c) => c.subject))].map((s) => cands.filter((c) => c.subject === s)) : [cands];
      if (pools.length === 0) pools.push([]);
      const judged = pools.flatMap((p) => subsets(p).map((s) => ({ s, ...judge(s, spec), credits: sum(s.map((c) => c.credits)) }))).filter((j) => j.legal);
      const bestF = Math.max(...judged.map((j) => j.fraction));
      const bestCredits = Math.max(...judged.filter((j) => j.fraction > bestF - EPS).map((j) => j.credits));
      const counted = ev.counted.map((i) => courses[i]);
      const mine = judge(counted, spec);

      const ctx = `case ${t}: ${JSON.stringify({ row, courses })}`;
      expect(mine.legal, ctx).toBe(true);
      if (row.sameSubject) expect(new Set(counted.map((c) => c.subject)).size, ctx).toBeLessThanOrEqual(1);
      expect(ev.met, ctx).toBe(judged.some((j) => j.met));
      expect(ev.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(ev.progress.creditsHave, ctx).toBe(bestCredits);
      expect(ev.progress.creditsHave).toBe(sum(counted.map((c) => c.credits)));
    }
  });
});

describe("distribution evaluator = brute force", () => {
  it("600 seeded instances across every shape (flow and search paths)", () => {
    const r = rng(29);
    for (let t = 0; t < 600; t++) {
      // Every third case is CAS-shaped (all categories required, doubling
      // allowed under a budget) so the budget actually binds.
      const casShaped = t % 3 === 0;
      const courses = casShaped ? randomCourses(r, r.int(2, 4), 0.6) : randomCourses(r, r.int(0, 6));
      const catIds = TAGS.filter(() => r.chance(0.8));
      if (catIds.length === 0) catIds.push("A");
      const perCategory: Record<string, { min?: number; max?: number }> = {};
      for (const k of catIds) {
        if (r.chance(0.25)) perCategory[k] = { ...(r.chance(0.5) ? { min: r.int(1, 2) } : {}), ...(r.chance(0.5) ? { max: r.int(0, 2) } : {}) };
      }
      const maxCat = casShaped ? 2 : r.int(1, 3);
      const shape: DistributionRow = {
        id: "d",
        label: "d",
        group: "g",
        source,
        kind: "distribution",
        ...(r.chance(0.3) ? { rule: { not: { subject: ["Z"] } } } : {}),
        categories: catIds.map((id) => ({ id, label: id, rule: { tag: [id] } })),
        requiredCourses: r.int(0, 4),
        minDistinctCategories: r.int(0, catIds.length),
        perCategory,
        maxCategoriesPerCourse: maxCat,
        ...(r.chance(0.6) ? { maxDoubleCountCourses: r.int(0, 2) } : {}),
        ...(r.chance(0.3) ? { maxPerSubject: r.int(1, 2) } : {}),
      };
      const row: DistributionRow = casShaped
        ? {
            ...shape,
            perCategory: {},
            minDistinctCategories: catIds.length,
            requiredCourses: r.int(1, catIds.length),
            maxDoubleCountCourses: r.int(0, 2),
          }
        : shape;
      const env = makeEnv(courses, {});
      const all = courses.map((_, i) => i);
      const ev = evaluateRow(row, { offered: all, all }, env);

      // Reference: every assignment of every eligible course to a category subset.
      const minK = catIds.map((k) => row.perCategory?.[k]?.min ?? 0);
      const maxK = catIds.map((k) => row.perCategory?.[k]?.max ?? Infinity);
      const elig = courses.filter((c) => !row.rule || matches(c, row.rule));
      const options = elig.map((c) => subsets(catIds.map((_, k) => k).filter((k) => matches(c, row.categories[k].rule))).filter((s) => s.length <= maxCat));
      const fractionOf = (counts: number[], n: number) => {
        const parts: number[] = [];
        if (row.requiredCourses > 0) parts.push(Math.min(1, n / row.requiredCourses));
        const covered = counts.filter((c) => c > 0).length;
        if (row.minDistinctCategories > 0) parts.push(Math.min(1, covered / row.minDistinctCategories));
        const sumMin = sum(minK);
        if (sumMin > 0) parts.push(sum(minK.map((m, k) => Math.min(m, counts[k]))) / sumMin);
        const met = n >= row.requiredCourses && covered >= row.minDistinctCategories && minK.every((m, k) => counts[k] >= m);
        return { met, fraction: met ? 1 : parts.length ? sum(parts) / parts.length : 1 };
      };
      const legal = (choice: number[][]) => {
        const counts = catIds.map(() => 0);
        const subj = new Map<string, number>();
        let doubles = 0;
        choice.forEach((ks, j) => {
          if (ks.length === 0) return;
          ks.forEach((k) => counts[k]++);
          if (ks.length > 1) doubles++;
          subj.set(elig[j].subject, (subj.get(elig[j].subject) ?? 0) + 1);
        });
        const ok =
          counts.every((c, k) => c <= maxK[k]) &&
          doubles <= (row.maxDoubleCountCourses ?? Infinity) &&
          [...subj.values()].every((n) => n <= (row.maxPerSubject ?? Infinity));
        return { ok, counts, n: choice.filter((ks) => ks.length > 0).length };
      };
      let bestF = -1;
      let anyMet = false;
      const walk = (j: number, choice: number[][]) => {
        if (j === elig.length) {
          const l = legal(choice);
          if (!l.ok) return;
          const f = fractionOf(l.counts, l.n);
          bestF = Math.max(bestF, f.fraction);
          anyMet ||= f.met;
          return;
        }
        for (const o of options[j]) {
          choice.push(o);
          walk(j + 1, choice);
          choice.pop();
        }
      };
      walk(0, []);

      // The reported assignment must itself be legal and score what it claims.
      const reported = elig.map((c) => {
        const i = courses.indexOf(c);
        return (ev.categories?.get(i) ?? []).map((id) => catIds.indexOf(id));
      });
      const mine = legal(reported);
      const ctx = `case ${t}: ${JSON.stringify({ row, courses })}`;
      expect(ev.exact, ctx).toBe(true);
      expect(mine.ok, ctx).toBe(true);
      expect(reported.every((ks) => ks.length <= maxCat), ctx).toBe(true);
      expect(ev.met, ctx).toBe(anyMet);
      expect(ev.fraction, ctx).toBeCloseTo(bestF, 9);
      expect(fractionOf(mine.counts, mine.n).fraction, ctx).toBeCloseTo(bestF, 9);
      expect(ev.progress.coursesHave).toBe(ev.counted.length);
      expect(ev.progress.categoriesHave).toEqual(catIds.filter((_, k) => mine.counts[k] > 0));
      expect(ev.counted.every((i) => (ev.categories?.get(i) ?? []).length >= 1)).toBe(true);
    }
  });
});
