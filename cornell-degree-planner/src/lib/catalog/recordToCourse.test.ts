import { describe, it, expect } from "vitest";
import { recordToCourse } from "./recordToCourse";
import { CatalogIndexRecordSchema } from "@/lib/schemas";

const base = {
  id: "CS-2110",
  subject: "CS",
  number: "2110",
  title: "Object-Oriented Programming and Data Structures",
  creditsMin: 3,
  creditsMax: 4,
  hasPrereqs: true,
};

describe("recordToCourse — roster carried through (spec 017 D6)", () => {
  it("copies the index record's roster so Place on board can highlight before the doc loads", () => {
    expect(recordToCourse(CatalogIndexRecordSchema.parse({ ...base, roster: "SP27" })).roster).toBe("SP27");
  });

  it("an index record without a roster stays null", () => {
    expect(recordToCourse(CatalogIndexRecordSchema.parse(base)).roster).toBeNull();
  });
});
