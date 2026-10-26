// scripts/promote-layer.ts
// Copy a resolved, verified layer out of its private provenance folder into the
// seeded layer folder (spec 019 D12): docs/provenance/<id>/merged.json →
// scripts/seed-data/layers/<family>/<id>.json. Only the layer is copied; the
// quotes stay private. The layer must pass the app's read boundary (LayerSchema
// + lintLayer). New majors stay hidden in the picker until the D16 hand check
// (seed-program-index.ts writes every major layer `hidden`).
//
// Run (from scripts/): npx tsx promote-layer.ts <merged.json> --family cas|cals

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { lintLayer } from "../cornell-degree-planner/src/lib/planner/distribution/lintLayer";
import { LAYERS_DIR, readDraft } from "./layer-authoring";

export function layerFileText(layer: unknown): string {
  return `${JSON.stringify(layer, null, 2)}\n`;
}

function main(): number {
  const args = process.argv.slice(2);
  const famIdx = args.indexOf("--family");
  const family = famIdx !== -1 ? args[famIdx + 1] : null;
  const src = args.find((a, i) => !a.startsWith("--") && i !== famIdx + 1);
  if (!src || (family !== "cas" && family !== "cals")) {
    console.error("usage: npx tsx promote-layer.ts <merged.json> --family cas|cals");
    return 2;
  }
  let draft;
  try {
    draft = readDraft(src);
  } catch (e) {
    console.error(`ABORTED: ${src} is not a valid draft: ${(e as Error).message}`);
    return 2;
  }
  const { layer } = draft;
  if (layer.family !== family) {
    console.error(`ABORTED: layer family is ${layer.family}, not ${family}`);
    return 1;
  }
  const lint = lintLayer(layer);
  if (lint.length) {
    console.error(`ABORTED: lint errors:\n  ${lint.join("\n  ")}`);
    return 1;
  }
  const out = join(LAYERS_DIR, family, `${layer.id}.json`);
  const text = layerFileText(layer);
  const before = existsSync(out) ? readFileSync(out, "utf-8").replace(/\r\n/g, "\n") : null;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  const rel = relative(process.cwd(), out);
  console.log(before == null ? `WROTE ${rel} (new)` : before === text ? `UNCHANGED ${rel}` : `UPDATED ${rel}`);
  return 0;
}

if (require.main === module) process.exit(main());
