// scripts/reset-run.ts
// Moves an earlier authoring run's outputs aside before a re-run (spec 019
// Phase 5), so no stale draft, verdict or golden report can be mistaken for
// the new run's. Everything except snapshot/, extract.json and previous/
// itself moves into previous/, replacing an older previous/ folder. The blind
// authors are told never to read previous/.
//
//   npx tsx reset-run.ts --program <layerId> [--dir <provenanceDir>]
//
// Exit: 0 done (also when there was nothing to move), 2 bad usage.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "fs";
import { join, resolve } from "path";
import { PROVENANCE_FILES, provenanceDir } from "./layer-authoring";

const KEEP = new Set([PROVENANCE_FILES.snapshotDir, PROVENANCE_FILES.extract, PROVENANCE_FILES.previousDir]);

/** Moves every run output in `dir` into `dir/previous/`; returns what moved. */
export function resetRun(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const outputs = readdirSync(dir).filter((f) => !KEEP.has(f));
  if (!outputs.length) return [];
  const prev = join(dir, PROVENANCE_FILES.previousDir);
  rmSync(prev, { recursive: true, force: true });
  mkdirSync(prev);
  for (const f of outputs) renameSync(join(dir, f), join(prev, f));
  return outputs;
}

function main(argv: string[]): number {
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const program = flag("--program");
  if (!program) {
    console.error("usage: npx tsx reset-run.ts --program <layerId> [--dir <provenanceDir>]");
    return 2;
  }
  let dir: string;
  try {
    dir = flag("--dir") ? resolve(flag("--dir")!) : provenanceDir(program);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const moved = resetRun(dir);
  console.log(moved.length ? `moved ${moved.length} earlier output(s) to previous/: ${moved.join(", ")}` : "nothing to move");
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
