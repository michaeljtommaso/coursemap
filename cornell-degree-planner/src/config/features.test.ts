import { describe, expect, it } from "vitest";
import { parseFlag } from "./features";
import { providerKind } from "@/services/reviews";

describe("parseFlag", () => {
  it("uses the default when the override is unset or blank", () => {
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag("", false)).toBe(false);
    expect(parseFlag("  ", true)).toBe(true);
  });
  it("reads off / false / 0 / no as off, in any case", () => {
    for (const v of ["off", "OFF", "false", "0", "no", " Off "]) expect(parseFlag(v, true), v).toBe(false);
  });
  it("reads anything else as on", () => {
    for (const v of ["on", "true", "1", "yes"]) expect(parseFlag(v, false), v).toBe(true);
  });
});

describe("Rate My Professor switch → reviews provider", () => {
  it("on uses the RMP adapter, off uses the empty (null) adapter", () => {
    expect(providerKind(true)).toBe("rmp");
    expect(providerKind(false)).toBe("null");
  });
});
