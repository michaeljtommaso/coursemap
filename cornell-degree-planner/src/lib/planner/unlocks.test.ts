import { describe, it, expect } from "vitest";
import { buildUnlocksMap, unlockCount } from "./unlocks";
import type { CatalogIndexRecord } from "@/lib/schemas";

function record(
  id: string,
  unlocks: string[] = [],
  opts: Partial<CatalogIndexRecord> = {}
): CatalogIndexRecord {
  return {
    id,
    subject: id.split("-")[0],
    number: id.split("-")[1] ?? "0000",
    title: id,
    creditsMin: 3,
    creditsMax: 3,
    hasPrereqs: false,
    offered: [],
    attrs: [],
    fws: false,
    unlocks,
    ...opts,
  };
}

describe("buildUnlocksMap / unlockCount", () => {
  it("plain records with no aliases: map mirrors unlocks field directly", () => {
    const map = buildUnlocksMap([
      record("CS-1110", ["CS-2110", "CS-2112"]),
      record("CS-2110", []),
    ]);
    expect(unlockCount(map, "CS-1110")).toBe(2);
    expect(unlockCount(map, "CS-2110")).toBe(0);
    expect(unlockCount(map, "unknown")).toBe(0);
  });

  it("canonical + alias share one merged entry, lookup works via either id", () => {
    // ENGRD-2110 is a cross-listed alias of CS-2110; each was synced with a
    // (possibly slightly different) unlocks list — the merge is the union.
    const aliases = { "ENGRD-2110": "CS-2110" };
    const map = buildUnlocksMap(
      [
        record("CS-2110", ["CS-3110"]),
        record("ENGRD-2110", ["CS-4410"]),
      ],
      aliases
    );
    expect(unlockCount(map, "CS-2110")).toBe(2);
    expect(unlockCount(map, "ENGRD-2110")).toBe(2);
    expect(map.get("CS-2110")).toEqual(["CS-3110", "CS-4410"]);
    // Both ids resolve to the identical merged array (same reference).
    expect(map.get("CS-2110")).toBe(map.get("ENGRD-2110"));
  });

  it("unlocks referencing an alias id are canonicalized in the merged set", () => {
    const aliases = { "ENGRD-2110": "CS-2110" };
    const map = buildUnlocksMap(
      [record("MATH-2940", ["ENGRD-2110"])],
      aliases
    );
    // The unlock target is stored canonicalized, not as the raw alias id.
    expect(map.get("MATH-2940")).toEqual(["CS-2110"]);
  });

  it("empty records → empty map", () => {
    const map = buildUnlocksMap([]);
    expect(map.size).toBe(0);
    expect(unlockCount(map, "anything")).toBe(0);
  });
});
