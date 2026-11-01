// scripts/promote-layer.ts
// The release step of the authoring chain (spec 019 D4/D12, Phase 5): copy a
// resolved, verified layer and its golden plan out of the private provenance
// folder into the public seed data:
//   docs/provenance/<id>/merged.json          → scripts/seed-data/layers/<family>/<id>.json  (layer only)
//   docs/provenance/<id>/golden-fixture.json  → scripts/seed-data/golden/layers/<id>.json
// Quotes, list provenance and everything else stay in provenance.
//
// Every layer kind goes through it; <id> is the LAYER id:
//   major          <programId>                      fixture layerIds [id],             ctx.programId = id
//   concentration  <programId>--<concentrationId>   fixture layerIds [programId, id],  ctx.programId = programId,
//                                                    ctx.concentrationId = concentrationId
//   college        cas-college, cals-college-2025, cals-college-pre2025
//                                                   fixture layerIds [id], a ctx the layer's appliesTo selects
// A concentration is refused until its major is promoted
// (seed-data/layers/<family>/<programId>.json, a major of the same family).
//
// It refuses unless the chain is complete and clean, judged from the files on
// disk (never from what an agent reported): every chain output present, the
// review sheet raises no flag (every unit verified correct, nothing missing,
// every real or equivalent difference decided, no open question, golden plan
// passing on this exact layer, merged draft checks clean, extracted lists
// sound, and verify.json and check-merged.json each carrying the layerSha256 of
// exactly this layer: an edited layer is never released on an earlier file),
// the golden report carries the hash of every fixture layer and each matches the
// layer being promoted or the promoted one in seed-data (a concentration's
// report must be on the major as promoted), the fixture fits its layers
// (check-golden-layer fixtureProblems), and the golden plan, re-run here on
// exactly the files being written, still passes.
//
// Re-checked HERE on the exact layer being written (not read from
// check-merged.json): lintLayer, publicTextFields vs snapshot/page.txt
// (copiedRun), and every spec 020 question's `quote` against page.txt (word
// for word in normal form: a question's quote IS published, as the Cornell
// sentence behind it, so it must be Cornell's). On the golden fixture, which is published too: every key must be
// a known one (fixtureKeyProblems); every plan and probe course is re-derived
// from the catalog dump plus the folder's verified extract.json page-only
// courses and must equal the fixture's embedded data (fixtureCourseProblems);
// and `description` and every `mustNotCount[].why` are checked for copied
// page text.
//
// Visibility: new majors stay hidden in the picker until the D16 hand check
// (seed-program-index.ts writes every major layer `hidden`). College and
// concentration layers have no picker entry of their own; a promoted college
// layer takes over from the Phase 2 fixture of the same id in --test seeding
// (seed-layers.ts: seed-data wins).
//
// Run (from scripts/): npx tsx promote-layer.ts --program <layerId> --family cas|cals [--dir <provenanceDir>]
// Exit 0 promoted, 1 refused, 2 bad usage or unreadable input.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { LayerSchema } from "../cornell-degree-planner/src/lib/schemas";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import type { GoldenFixture } from "../cornell-degree-planner/src/lib/planner/distribution/goldenPlan";
import { buildGoldenReport, fixtureCourseProblems, fixtureKeyProblems, fixtureProblems, indexLayerFiles, loadPageOnly } from "./check-golden-layer";
import {
  DEFAULT_DUMP,
  GOLDEN_LAYERS_DIR,
  LAYERS_DIR,
  PROVENANCE_FILES,
  checkQuote,
  copiedRun,
  layerSha256,
  loadDistCatalog,
  provenanceDir,
  publicTextFields,
  type DistCourse,
  type Layer,
} from "./layer-authoring";
import { InputError, buildReview, loadReviewInputs } from "./review-sheet";

export function layerFileText(layer: unknown): string {
  return `${JSON.stringify(layer, null, 2)}\n`;
}

const USAGE = "usage: npx tsx promote-layer.ts --program <layerId> --family cas|cals [--dir <provenanceDir>]";

function writeIfChanged(path: string, text: string): string {
  const before = existsSync(path) ? readFileSync(path, "utf-8").replace(/\r\n/g, "\n") : null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const rel = relative(process.cwd(), path);
  return before == null ? `WROTE ${rel} (new)` : before === text ? `UNCHANGED ${rel}` : `UPDATED ${rel}`;
}

export type PromoteOptions = {
  /** The layer id (= the provenance folder name). */
  program: string;
  family: "cas" | "cals";
  /** The provenance folder. */
  base: string;
  /** seed-data/layers (destination, and where a concentration's major is found). */
  layersDir?: string;
  /** seed-data/golden/layers (destination). */
  goldenDir?: string;
  /** Catalog course id → course, to re-derive the fixture's courses from.
   *  Default: the authoring dump (DEFAULT_DUMP, or `dump`). */
  catalog?: Map<string, DistCourse>;
  dump?: string;
};

export type PromoteResult = { refusals: string[]; layer: Layer | null; fixtureText: string | null; layerPath: string; goldenPath: string };

/** The layerIds a fixture for this layer must have (see the header); its ctx is
 *  checked by fixtureProblems. */
function expectedLayerIds(layer: Layer): string[] {
  return layer.kind === "concentration" ? [layer.programId ?? "", layer.id] : [layer.id];
}

/** Every check, no writes. Throws InputError when the folder cannot be read. */
export function checkPromotion(opts: PromoteOptions): PromoteResult {
  const { program, family, base } = opts;
  const layersDir = opts.layersDir ?? LAYERS_DIR;
  const goldenDir = opts.goldenDir ?? GOLDEN_LAYERS_DIR;
  const inputs = loadReviewInputs(base);

  const refusals: string[] = [];
  const { merged } = inputs;
  const layer = merged.layer;
  const layerPath = join(layersDir, family, `${layer.id}.json`);
  const goldenPath = join(goldenDir, `${layer.id}.json`);
  if (layer.id !== program) refusals.push(`merged layer id is ${layer.id}, not ${program}`);
  if (layer.family !== family) refusals.push(`layer family is ${layer.family}, not ${family}`);
  const present: [string, unknown][] = [
    [PROVENANCE_FILES.meta, inputs.meta],
    [PROVENANCE_FILES.diffJson, inputs.diff],
    [PROVENANCE_FILES.resolution, inputs.resolution],
    [PROVENANCE_FILES.checkMerged, inputs.checkMerged],
    [PROVENANCE_FILES.verify, inputs.verify],
    [PROVENANCE_FILES.golden, inputs.golden],
  ];
  for (const [file, value] of present) if (value === undefined) refusals.push(`${file} is missing (run the whole chain)`);

  const { summary } = buildReview(inputs);
  if (summary.flags) refusals.push(`the review sheet raises ${summary.flags} flag(s); see ${PROVENANCE_FILES.review} (npx tsx review-sheet.ts --program ${program})`);
  for (const line of lintLayer(layer)) refusals.push(`lint: ${line}`);

  const pagePath = join(base, PROVENANCE_FILES.pageText);
  const pageText = existsSync(pagePath) ? readFileSync(pagePath, "utf-8") : "";
  if (!pageText) refusals.push(`${PROVENANCE_FILES.pageText} is missing`);
  // Published text must not copy the page (re-checked on this exact layer).
  if (pageText)
    for (const f of publicTextFields(layer)) {
      const run = copiedRun(f.text, pageText);
      if (run) refusals.push(`public text copies the page: ${f.where} ("${run}")`);
    }
  // A question's quote is published as Cornell's sentence: it must be on the page.
  if (pageText)
    for (const [i, q] of (layer.questions ?? []).entries()) {
      const [qc] = checkQuote(pageText, [q.quote]);
      if (!qc.found) refusals.push(`question quote is not on the page word for word: questions[${i}] (${q.type})`);
    }

  // Kind-specific identity.
  const index = indexLayerFiles([{ dir: layersDir, recursive: true }]);
  if (layer.kind === "major" && layer.programId !== layer.id) refusals.push(`a major layer's id must be its programId (${layer.id} vs ${layer.programId})`);
  if (layer.kind === "college" && layer.id.includes("--")) refusals.push(`a college layer id has no "--" (that names a concentration): ${layer.id}`);
  let promotedMajor: Layer | null = null;
  if (layer.kind === "concentration") {
    if (layer.id !== `${layer.programId}--${layer.concentrationId}`)
      refusals.push(`a concentration layer's id must be <programId>--<concentrationId> (${layer.id} vs ${layer.programId}--${layer.concentrationId})`);
    const majorPath = join(layersDir, family, `${layer.programId}.json`);
    if (!existsSync(majorPath)) refusals.push(`its major ${layer.programId} is not promoted yet (no ${relative(process.cwd(), majorPath)}): promote the major first`);
    else {
      try {
        promotedMajor = LayerSchema.parse(JSON.parse(readFileSync(majorPath, "utf-8"))) as Layer;
        if (promotedMajor.kind !== "major" || promotedMajor.id !== layer.programId || promotedMajor.family !== layer.family)
          refusals.push(`${relative(process.cwd(), majorPath)} is not the ${layer.family} major ${layer.programId} (it is ${promotedMajor.family} ${promotedMajor.kind} ${promotedMajor.id})`);
      } catch (e) {
        refusals.push(`the promoted major ${relative(process.cwd(), majorPath)} is unreadable: ${(e as Error).message}`);
        promotedMajor = null;
      }
    }
  }

  const fixturePath = join(base, PROVENANCE_FILES.goldenFixture);
  let fixtureText: string | null = null;
  if (!existsSync(fixturePath)) refusals.push(`${PROVENANCE_FILES.goldenFixture} is missing`);
  else {
    try {
      fixtureText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
      const fx = JSON.parse(fixtureText) as Partial<GoldenFixture>;
      if (fx.programId !== program) refusals.push(`golden fixture is for ${fx.programId}, not ${program}`);
      // An empty plan (a layer of confirm rows only) needs no course data; any
      // plan or probe course does.
      const needsCourses = (fx.plan?.length ?? 0) > 0 || (fx.mustNotCount?.length ?? 0) > 0;
      if (!Array.isArray(fx.courses) || (needsCourses && !fx.courses.length))
        refusals.push("golden fixture has no course data (run check-golden-layer --write)");
      const run = fx.description && pageText ? copiedRun(fx.description, pageText) : null;
      if (run) refusals.push(`golden fixture description copies the page ("${run}")`);
      for (const p of fixtureKeyProblems(fx)) refusals.push(`golden fixture: ${p}`);
      if (Array.isArray(fx.mustNotCount) && pageText)
        fx.mustNotCount.forEach((probe, i) => {
          const why = (probe as { why?: unknown } | null)?.why;
          const r = typeof why === "string" ? copiedRun(why, pageText) : null;
          if (r) refusals.push(`golden fixture mustNotCount[${i}].why copies the page ("${r}")`);
        });
      if (Array.isArray(fx.plan) && Array.isArray(fx.courses)) {
        // The embedded course data is published and drives the plan: re-derive it.
        let catalog = opts.catalog;
        if (!catalog) {
          try {
            catalog = loadDistCatalog(opts.dump ?? DEFAULT_DUMP).byId;
          } catch (e) {
            refusals.push(`cannot re-derive the golden fixture's courses: ${(e as Error).message}`);
          }
        }
        if (catalog) {
          const page = loadPageOnly(base, new Set(catalog.keys()));
          if (page.error) refusals.push(`golden fixture: ${PROVENANCE_FILES.extract} cannot be used to check page-only courses: ${page.error}`);
          for (const p of fixtureCourseProblems(fx as GoldenFixture, catalog, page.byId)) refusals.push(`golden fixture: ${p}`);
        }
      }
      const want = expectedLayerIds(layer);
      if (JSON.stringify(fx.layerIds) !== JSON.stringify(want))
        refusals.push(`golden fixture layerIds are ${JSON.stringify(fx.layerIds)}; a ${layer.kind} layer's must be ${JSON.stringify(want)}`);
      else if (fx.layerIds && fx.ctx && Array.isArray(fx.plan) && Array.isArray(fx.courses)) {
        // The fixture's layers: this one, and (concentration) the promoted major.
        const layers: Layer[] = [];
        for (const id of fx.layerIds) {
          if (id === layer.id) layers.push(layer);
          else if (promotedMajor && id === promotedMajor.id) layers.push(promotedMajor);
          else refusals.push(`golden fixture layer ${id} is neither this layer nor its promoted major${index.has(id) ? "" : " (not in seed-data)"}`);
        }
        if (layers.length === fx.layerIds.length) {
          for (const p of fixtureProblems(layers, fx as GoldenFixture)) refusals.push(`golden fixture: ${p}`);
          const hashes = inputs.golden?.layerHashes;
          for (const l of layers) {
            const h = hashes?.[l.id];
            if (!h) refusals.push(`${PROVENANCE_FILES.golden} has no hash for ${l.id}: re-run check-golden-layer with --report`);
            else if (h !== layerSha256(l))
              refusals.push(
                `${PROVENANCE_FILES.golden} was computed on a different version of ${l.id}` +
                  (l === layer ? "" : " than the one promoted in seed-data") +
                  ": re-run check-golden-layer",
              );
          }
          try {
            const now = buildGoldenReport(layers, fx as GoldenFixture);
            if (!now.ok) refusals.push(`the golden plan does not pass on the files being promoted (${now.pct}%): re-run check-golden-layer`);
          } catch (e) {
            refusals.push(`the golden plan cannot run: ${(e as Error).message}`);
          }
        }
      } else refusals.push("golden fixture needs ctx, plan and courses");
    } catch (e) {
      refusals.push(`golden fixture is unreadable: ${(e as Error).message}`);
      fixtureText = null;
    }
  }

  return { refusals, layer, fixtureText, layerPath, goldenPath };
}

/** Check, then write both files when nothing is refused. Returns the exit code. */
export function promote(opts: PromoteOptions, log: (s: string) => void = console.log, logErr: (s: string) => void = console.error): number {
  let r: PromoteResult;
  try {
    r = checkPromotion(opts);
  } catch (e) {
    logErr(e instanceof InputError || e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (r.refusals.length) {
    logErr(`REFUSED: ${opts.program} is not ready to promote:\n  - ${r.refusals.join("\n  - ")}`);
    return 1;
  }
  log(writeIfChanged(r.layerPath, layerFileText(r.layer)));
  log(writeIfChanged(r.goldenPath, r.fixtureText!));
  log(`PROMOTED ${r.layer!.kind} layer${r.layer!.kind === "major" ? " (hidden until the hand check)" : ""}. Commit both files.`);
  return 0;
}

function main(): number {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const program = flag("--program");
  const family = flag("--family");
  const dirArg = flag("--dir");
  if (!program || (family !== "cas" && family !== "cals")) {
    console.error(USAGE);
    return 2;
  }
  let base: string;
  try {
    base = dirArg ? resolve(dirArg) : provenanceDir(program);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  return promote({ program, family, base });
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
