import { describe, it, expect } from "vitest";
import { LayerSchema } from "@/lib/schemas";
import { decodeLayerDoc, encodeLayerDoc } from "./layerDoc";
import type { Layer } from "./types";

const SRC = { url: "https://catalog.cornell.edu/", anchor: "test" };

describe("layerDoc — questions round-trip (spec 020)", () => {
  it("keeps a layer's questions and answered leaves intact through encode → decode → parse", () => {
    const layer: Layer = {
      id: "p",
      kind: "major",
      family: "cals",
      name: "M",
      catalogYear: "2026-27",
      programId: "p",
      rows: [
        {
          id: "elect",
          kind: "pool",
          label: "Electives",
          group: "G",
          source: SRC,
          rule: { allOf: [{ subject: ["BIOMG"] }, { answered: "approvedFor:p/elect" }] },
          requiredCourses: 1,
          requiredCredits: 0,
        },
      ],
      questions: [
        { source: SRC, quote: "With permission of your advisor.", type: "approvedFor", row: "elect", courses: { subject: ["BIOMG"] }, approver: "advisor" },
        { source: SRC, quote: "Counts at 3 credits.", type: "creditsTaken", course: "BIOMI-4850", values: [2, 3] },
        { source: SRC, quote: "The sequence.", type: "sequenceDone", course: "NTRES-4300", sequence: ["NTRES-4301", "NTRES-4302"], credits: 4 },
      ],
    };
    const doc = encodeLayerDoc(layer);
    const decoded = decodeLayerDoc(doc);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(LayerSchema.parse(decoded.raw)).toEqual(layer);
  });
});
