/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { solve } from "./index";
import { verifyAssignment } from "./verify";
import type { DistCourse, DistributionResult, Layer, LayerFamily, StudentContext } from "./types";

/**
 * Known-good / known-bad plans (spec 019 Phase 2 "done when"): each plan in
 * fixtures/plans names the college layers it runs against and the status it
 * expects for the rows it is about. Every plan runs through the full path —
 * schema-parsed layers → solve (solver + checker) — and the checker must
 * accept the result untouched.
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
  expect: Record<string, string>;
  expectExactlyOneMet?: string[][];
};

const layers = new Map<string, Layer>();
for (const f of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
  const layer = LayerSchema.parse(JSON.parse(readFileSync(join(FIXTURES, f), "utf8")));
  layers.set(layer.id, layer);
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
      const input = {
        layers: plan.layers.map((id) => {
          const l = layers.get(id);
          if (!l) throw new Error(`unknown layer ${id}`);
          return l;
        }),
        courses: plan.courses,
        ctx: plan.ctx,
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
