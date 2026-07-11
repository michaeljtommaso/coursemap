/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAttributeMatch } from "./satisfies";

/**
 * Seed-integrity check (spec 010 §2, Unit 10B). Runs in vitest — the seed JSONs
 * are read from disk so this needs no Firestore. Guards two invariants the FWS
 * re-model must preserve forever:
 *   1. NO "FWIS" token survives anywhere under scripts/seed-data (the pattern
 *      token died; legacy-sql/ is historical and out of scope here).
 *   2. EVERY attribute slot's attributeMatch parses to a usable AttributeMatch
 *      (normalizeAttributeMatch → non-null), so no attribute requirement is
 *      unmatchable-by-construction.
 */

/** Walk up from this file until we find scripts/seed-data (robust to layout). */
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

/** All *.json files directly in seed-data plus seed-data/programs-2025. */
function seedJsonFiles(): string[] {
  const files: string[] = [];
  const top = readdirSync(SEED_DIR, { withFileTypes: true });
  for (const e of top) {
    if (e.isFile() && e.name.endsWith(".json")) files.push(join(SEED_DIR, e.name));
    if (e.isDirectory()) {
      const sub = join(SEED_DIR, e.name);
      for (const f of readdirSync(sub)) if (f.endsWith(".json")) files.push(join(sub, f));
    }
  }
  return files;
}

/** Recursively collect slot-shaped objects (have string `kind` + `slotRow`). */
function collectSlots(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const el of node) collectSlots(el, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.kind === "string" && typeof o.slotRow === "number") out.push(o);
    for (const v of Object.values(o)) collectSlots(v, out);
  }
}

const FILES = seedJsonFiles();

describe("seed integrity (spec 010 §2)", () => {
  it("finds seed JSON files", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("contains zero 'FWIS' tokens across seed-data", () => {
    const offenders = FILES.filter((f) => readFileSync(f, "utf-8").includes("FWIS"));
    expect(offenders).toEqual([]);
  });

  it("every attribute slot parses to a usable AttributeMatch, and FWS was re-modeled", () => {
    let attributeSlots = 0;
    const bad: string[] = [];
    for (const f of FILES) {
      const slots: Record<string, unknown>[] = [];
      collectSlots(JSON.parse(readFileSync(f, "utf-8")), slots);
      for (const s of slots) {
        if (s.kind !== "attribute") continue;
        attributeSlots++;
        if (normalizeAttributeMatch(s.attributeMatch) == null) bad.push(`${f} :: ${String(s.id)}`);
      }
    }
    expect(bad).toEqual([]);
    // The FWS re-model produced attribute slots (slots.json + programs.json +
    // the nine programs-2025 majors all carry them).
    expect(attributeSlots).toBeGreaterThan(0);
  });
});
