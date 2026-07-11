import { describe, it, expect } from "vitest";
import { selectUnlockGhosts } from "./unlockGhosts";
import type { CatalogIndexRecord } from "@/lib/schemas";

function record(id: string): CatalogIndexRecord {
  const [subject, number] = id.split("-");
  return {
    id,
    subject: subject ?? "",
    number: number ?? "0000",
    title: id,
    creditsMin: 3,
    creditsMax: 3,
    hasPrereqs: false,
    offered: [],
    attrs: [],
    fws: false,
    unlocks: [],
  };
}

function recordMap(ids: string[]): Map<string, CatalogIndexRecord> {
  return new Map(ids.map((id) => [id, record(id)]));
}

const hovered = { id: "CS-2110", number: "2110" };

describe("selectUnlockGhosts", () => {
  it("orders nearest course-level first (3000 before 4000 for a 2000-level)", () => {
    const ids = ["CS-4820", "CS-3110", "CS-4780", "CS-3410"];
    const out = selectUnlockGhosts(ids, hovered, new Set(), recordMap(ids));
    expect(out.map((r) => r.id)).toEqual(["CS-3110", "CS-3410", "CS-4780", "CS-4820"]);
  });

  it("filters out courses already placed on the plan", () => {
    const ids = ["CS-3110", "CS-3410", "CS-4780"];
    const out = selectUnlockGhosts(ids, hovered, new Set(["CS-3410"]), recordMap(ids));
    expect(out.map((r) => r.id)).toEqual(["CS-3110", "CS-4780"]);
  });

  it("filters out the hovered course itself", () => {
    const ids = ["CS-2110", "CS-3110"];
    const out = selectUnlockGhosts(ids, hovered, new Set(), recordMap(ids));
    expect(out.map((r) => r.id)).toEqual(["CS-3110"]);
  });

  it("drops ids without an index record (can't render a chip)", () => {
    const ids = ["CS-3110", "CS-9999"];
    const out = selectUnlockGhosts(ids, hovered, new Set(), recordMap(["CS-3110"]));
    expect(out.map((r) => r.id)).toEqual(["CS-3110"]);
  });

  it("dedupes repeated ids", () => {
    const ids = ["CS-3110", "CS-3110"];
    const out = selectUnlockGhosts(ids, hovered, new Set(), recordMap(["CS-3110"]));
    expect(out.map((r) => r.id)).toEqual(["CS-3110"]);
  });

  it("ties broken by numeric then id", () => {
    const ids = ["CS-3410", "CS-3110"];
    const out = selectUnlockGhosts(ids, hovered, new Set(), recordMap(ids));
    expect(out.map((r) => r.id)).toEqual(["CS-3110", "CS-3410"]);
  });
});
