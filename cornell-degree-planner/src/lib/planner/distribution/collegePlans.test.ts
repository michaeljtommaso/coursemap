/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { solve } from "./index";
import { verifyAssignment } from "./verify";
import { applyCourseMarks } from "../questions/applyCourseMarks";
import type { Answers, DistCourse, DistributionResult, Layer, LayerFamily, StudentContext } from "./types";

/**
 * Known-good / known-bad plans (spec 019 Phase 2 "done when"): each plan in
 * fixtures/plans names the college layers it runs against and the status it
 * expects for the rows it is about. Every plan runs through the full path —
 * schema-parsed layers → solve (solver + checker) — and the checker must
 * accept the result untouched. A plan may carry the student's `answers`
 * (spec 020): credit marks are applied to its courses first, as the app does,
 * and the answers go to the engine and the checker.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

type Plan = {
  id: string;
  description: string;
  family: LayerFamily;
  ctx: StudentContext;
  layers: string[];
  courses: DistCourse[];
  answers?: Answers;
  expect: Record<string, string>;
  expectExactlyOneMet?: string[][];
};

const layers = new Map<string, Layer>();
for (const f of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
  const layer = LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, f), "utf8")));
  layers.set(layer.id, layer);
}
// A released college layer (scripts/seed-data/layers/<family>/) takes over
// from its Phase 2 fixture, as it does in seeding: the plans run on the rules
// students will get.
const SEED_LAYERS = resolve(HERE, "../../../../../scripts/seed-data/layers");
if (!existsSync(SEED_LAYERS)) throw new Error(`no seed layers folder at ${SEED_LAYERS}`);
for (const family of ["cas", "cals"]) {
  for (const id of [...layers.keys()]) {
    const p = join(SEED_LAYERS, family, `${id}.json`);
    if (existsSync(p)) layers.set(id, LayerSchema.parse(JSON.parse(readFileSync(p, "utf8"))));
  }
}

/** A row by `${layerId}:${rowId}`, looking inside anyOf children too. */
function findStatus(result: DistributionResult, key: string): string {
  const [layerId, rowId] = key.split(":");
  const rows = result.layers.find((l) => l.layerId === layerId)?.rows ?? [];
  for (const r of rows) {
    if (r.rowId === rowId) return r.status;
    const child = r.children?.find((c) => c.rowId === rowId);
    if (child) return child.status;
  }
  return "absent";
}

const plansDir = resolve(FIXTURES, "plans");
const plans: Plan[] = readdirSync(plansDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(plansDir, f), "utf8")) as Plan);

describe("college layer plans", () => {
  it("has plans for every college layer", () => {
    for (const id of layers.keys()) {
      expect(plans.some((p) => p.layers.includes(id)), id).toBe(true);
    }
  });

  for (const plan of plans) {
    it(`${plan.id} — ${plan.description}`, () => {
      const planLayers = plan.layers.map((id) => {
        const l = layers.get(id);
        if (!l) throw new Error(`unknown layer ${id}`);
        return l;
      });
      const input = {
        layers: planLayers,
        courses: plan.answers ? applyCourseMarks(plan.courses, planLayers, plan.answers.marks) : plan.courses,
        ctx: plan.ctx,
        ...(plan.answers ? { answers: plan.answers } : {}),
      };
      const result = solve(input);
      expect(result.verifyLog).toEqual([]);
      expect(verifyAssignment(input, result).rejections).toEqual([]);
      expect(result.capped).toBe(false);

      const got: Record<string, string> = {};
      for (const key of Object.keys(plan.expect)) got[key] = findStatus(result, key);
      expect(got).toEqual(plan.expect);

      // A genuine tie (one course, two rows it could fill): exactly one is met.
      for (const group of plan.expectExactlyOneMet ?? []) {
        const met = group.filter((key) => findStatus(result, key) === "met");
        expect(met, group.join(" | ")).toHaveLength(1);
      }
    });
  }
});
