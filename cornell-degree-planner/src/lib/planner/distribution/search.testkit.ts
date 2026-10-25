import type { DistCourse } from "./types";

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

/** Every subset of `xs` (as arrays, in order). */
export function subsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}
