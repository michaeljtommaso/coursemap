// scripts/promote-layer.ts
// The release step of the authoring chain (spec 019 D4/D12): copy a resolved,
// verified layer and its golden plan out of the private provenance folder into
// the public seed data:
//   docs/provenance/<id>/merged.json          → scripts/seed-data/layers/<family>/<id>.json  (layer only)
//   docs/provenance/<id>/golden-fixture.json  → scripts/seed-data/golden/layers/<id>.json
// Quotes never leave provenance.
//
// It refuses unless the chain is complete and clean, judged from the files on
// disk (never from what an agent reported): every chain output present, the
// review sheet raises no flag (every unit verified correct, nothing missing,
// every real or equivalent difference decided, no open question, golden plan
// passing on this exact layer, merged draft checks clean), the layer lints, and
// no published text copies the page. New majors stay hidden in the picker until
// the D16 hand check (seed-program-index.ts writes every major layer `hidden`).
//
// Run (from scripts/): npx tsx promote-layer.ts --program <id> --family cas|cals [--dir <provenanceDir>]
// Exit 0 promoted, 1 refused, 2 bad usage or unreadable input.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { GOLDEN_LAYERS_DIR, LAYERS_DIR, PROVENANCE_FILES, copiedRun, provenanceDir } from "./layer-authoring";
import { InputError, buildReview, loadReviewInputs } from "./review-sheet";

export function layerFileText(layer: unknown): string {
  return `${JSON.stringify(layer, null, 2)}\n`;
}

const USAGE = "usage: npx tsx promote-layer.ts --program <id> --family cas|cals [--dir <provenanceDir>]";

function writeIfChanged(path: string, text: string): string {
  const before = existsSync(path) ? readFileSync(path, "utf-8").replace(/\r\n/g, "\n") : null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const rel = relative(process.cwd(), path);
  return before == null ? `WROTE ${rel} (new)` : before === text ? `UNCHANGED ${rel}` : `UPDATED ${rel}`;
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
  let inputs;
  try {
    base = dirArg ? resolve(dirArg) : provenanceDir(program);
    inputs = loadReviewInputs(base);
  } catch (e) {
    console.error(e instanceof InputError || e instanceof Error ? e.message : String(e));
    return 2;
  }

  const refusals: string[] = [];
  const { merged } = inputs;
  const layer = merged.layer;
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

  const fixturePath = join(base, PROVENANCE_FILES.goldenFixture);
  let fixtureText: string | null = null;
  if (!existsSync(fixturePath)) refusals.push(`${PROVENANCE_FILES.goldenFixture} is missing`);
  else {
    try {
      const fx = JSON.parse(readFileSync(fixturePath, "utf-8")) as { programId?: string; description?: string; courses?: unknown[] };
      if (fx.programId !== program) refusals.push(`golden fixture is for ${fx.programId}, not ${program}`);
      if (!Array.isArray(fx.courses) || !fx.courses.length) refusals.push("golden fixture has no course data (run check-golden-layer --write)");
      const run = fx.description && pageText ? copiedRun(fx.description, pageText) : null;
      if (run) refusals.push(`golden fixture description copies the page ("${run}")`);
      fixtureText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    } catch (e) {
      refusals.push(`golden fixture is unreadable: ${(e as Error).message}`);
    }
  }

  if (refusals.length) {
    console.error(`REFUSED: ${program} is not ready to promote:\n  - ${refusals.join("\n  - ")}`);
    return 1;
  }
  console.log(writeIfChanged(join(LAYERS_DIR, family, `${layer.id}.json`), layerFileText(layer)));
  console.log(writeIfChanged(join(GOLDEN_LAYERS_DIR, `${layer.id}.json`), fixtureText!));
  console.log("PROMOTED (hidden until the hand check). Commit both files.");
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
