import { describe, expect, it } from "vitest";
import { parseIndexChunks } from "./parseIndex";

const record = (id: string, title: unknown = `Title of ${id}`) => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title, creditsMin: 3, creditsMax: 3, hasPrereqs: false };
};

describe("parseIndexChunks — one bad record never takes down search", () => {
  it("keeps every good record and skips a record the schema rejects", () => {
    const { records, skipped } = parseIndexChunks([
      { records: [record("CS-2110"), record("PLSCI-4960", null)] },
      { records: [record("ECON-2040")] },
    ]);
    expect(records.map((r) => r.id)).toEqual(["CS-2110", "ECON-2040"]);
    expect(skipped).toEqual(["PLSCI-4960"]);
  });

  it("ignores a chunk with no records array and names a record with no id", () => {
    const { records, skipped } = parseIndexChunks([{ nope: 1 }, null, { records: [{ title: "x" }, record("CS-1110")] }]);
    expect(records.map((r) => r.id)).toEqual(["CS-1110"]);
    expect(skipped).toEqual(["(no id)"]);
  });
});
