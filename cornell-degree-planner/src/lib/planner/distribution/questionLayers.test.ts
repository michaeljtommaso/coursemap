/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerSchema } from "@/lib/schemas";
import { applyCourseMarks } from "../questions/applyCourseMarks";
import { openQuestions } from "../questions/openQuestions";
import { isFactRef, isValidAnswerKey, questionRef } from "../questions/keys";
import { solve } from "./index";
import { lintLayer } from "./lintLayer";
import { verifyAssignment } from "./verify";
import type { Answers, DistCourse, DistributionResult, Layer, QuestionType, SolveInput, StudentContext } from "./types";

/**
 * Question test majors (spec 020 D9): one small fictional major per question
 * type in scripts/seed-data/layers-test/questions/ (seeded into the emulator by
 * seed-layers.ts --test), each with fictional students in
 * scripts/seed-data/golden/questions/<layerId>.json who answer yes, no, or
 * nothing. Every student runs the app's path: credit marks applied to the
 * courses (applyCourseMarks), then solve (solver + checker) with the answers,
 * and the checker must accept the result. `expect` gives row statuses;
 * `expectOpen` the answer keys openQuestions offers (the question shows only
 * while a yes would help).
 */

function findSeedDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "scripts", "seed-data");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate scripts/seed-data");
}

const SEED_DIR = findSeedDir();
const LAYER_DIR = join(SEED_DIR, "layers-test", "questions");
const STUDENT_DIR = join(SEED_DIR, "golden", "questions");

type Student = {
  id: string;
  description: string;
  plan: string[];
  answers?: Answers;
  expect: Record<string, string>;
  expectOpen?: string[];
};
type StudentFile = { layerId: string; description: string; ctx: StudentContext; courses: DistCourse[]; students: Student[] };

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));
const jsonIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

const LAYER_FILES = jsonIn(LAYER_DIR);
const STUDENT_FILES = jsonIn(STUDENT_DIR);

const layers = new Map<string, Layer>();
for (const f of LAYER_FILES) {
  const parsed = LayerSchema.safeParse(readJson(join(LAYER_DIR, f)));
  if (parsed.success) layers.set(parsed.data.id, parsed.data as Layer);
}

const ALL_TYPES: QuestionType[] = ["usedAs", "approvedFor", "creditsTaken", "sequenceDone", "courseCondition", "studentFact"];

function statusOf(result: DistributionResult, layerId: string, rowId: string): string {
  const rows = result.layers.find((l) => l.layerId === layerId)?.rows ?? [];
  for (const r of rows) {
    if (r.rowId === rowId) return r.status;
    const child = r.children?.find((c) => c.rowId === rowId);
    if (child) return child.status;
  }
  return "absent";
}

describe("question test majors (layers-test/questions)", () => {
  it("has one test major per question type, each with a student file", () => {
    const types = [...layers.values()].flatMap((l) => (l.questions ?? []).map((q) => q.type)).sort();
    expect(types).toEqual([...ALL_TYPES].sort());
    expect(STUDENT_FILES).toEqual(LAYER_FILES);
  });

  it.each(LAYER_FILES)("%s parses, lints clean, and is a major named for its program", (file) => {
    const parsed = LayerSchema.safeParse(readJson(join(LAYER_DIR, file)));
    expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    if (!parsed.success) return;
    const layer = parsed.data as Layer;
    expect(lintLayer(layer)).toEqual([]);
    expect(`${layer.id}.json`).toBe(file);
    expect(layer.kind).toBe("major");
    expect(layer.programId).toBe(layer.id);
    expect(layer.questions?.length).toBe(1);
  });
});

describe("question test students (golden/questions)", () => {
  for (const file of STUDENT_FILES) {
    const fx = readJson(join(STUDENT_DIR, file)) as StudentFile;

    describe(fx.layerId, () => {
      const layer = layers.get(fx.layerId);
      const byId = new Map(fx.courses.map((c) => [c.id, c]));

      it("names its layer and its course data, with a yes and a no-or-unanswered student", () => {
        expect(`${fx.layerId}.json`).toBe(file);
        expect(layer, `no layer ${fx.layerId} in layers-test/questions`).toBeDefined();
        expect(fx.ctx.programId).toBe(fx.layerId);
        for (const st of fx.students) for (const id of st.plan) expect(byId.has(id), `${st.id}: no course data for ${id}`).toBe(true);
        const answered = fx.students.filter((st) => st.answers);
        expect(answered.length, "a student who answers").toBeGreaterThan(0);
        expect(fx.students.some((st) => !st.answers), "a student who has not answered").toBe(true);
      });

      for (const st of fx.students) {
        it(`${st.id} — ${st.description}`, () => {
          if (!layer) throw new Error(`no layer ${fx.layerId}`);
          // Answer keys name this layer's question, in the right store.
          const refs = new Set((layer.questions ?? []).map((q) => questionRef(layer.id, q)));
          for (const key of Object.keys(st.answers?.marks ?? {})) {
            expect(isValidAnswerKey(key), key).toBe(true);
            expect(refs.has(key.split("@")[0]) && !isFactRef(key.split("@")[0]), `${key}: not a mark this layer asks`).toBe(true);
          }
          for (const key of Object.keys(st.answers?.facts ?? {})) expect(refs.has(key) && isFactRef(key), `${key}: not a fact this layer asks`).toBe(true);

          const placed = st.plan.map((id) => byId.get(id)!);
          const input: SolveInput = {
            layers: [layer],
            courses: applyCourseMarks(placed, [layer], st.answers?.marks ?? {}),
            ctx: fx.ctx,
            ...(st.answers ? { answers: st.answers } : {}),
          };
          const result = solve(input);
          expect(result.verifyLog).toEqual([]);
          expect(verifyAssignment(input, result).rejections).toEqual([]);
          const got = Object.fromEntries(Object.keys(st.expect).map((rowId) => [rowId, statusOf(result, layer.id, rowId)]));
          expect(got).toEqual(st.expect);
          if (st.expectOpen) expect(openQuestions(input, result, solve).map((q) => q.key)).toEqual(st.expectOpen);
        });
      }
    });
  }
});
