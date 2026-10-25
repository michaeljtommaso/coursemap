import { describe, expect, it } from "vitest";
import { translateWaivers } from "./waiverTranslation";

describe("translateWaivers", () => {
  const map = {
    "infosci-core-1": "cals-info-science:core-intro",
    "infosci-core-2": "cals-info-science:core-data",
    "infosci-fws": "cals-college:fws",
    "infosci-retired": null,
  };

  it("maps old requirement ids to layer:row keys, in order", () => {
    expect(translateWaivers(["infosci-fws", "infosci-core-1"], map)).toEqual([
      "cals-college:fws",
      "cals-info-science:core-intro",
    ]);
  });

  it("drops a waiver whose mapping is null", () => {
    expect(translateWaivers(["infosci-retired", "infosci-core-2"], map)).toEqual([
      "cals-info-science:core-data",
    ]);
  });

  it("keeps ids the map doesn't name", () => {
    expect(translateWaivers(["cals-college:fws", "pe-1"], map)).toEqual(["cals-college:fws", "pe-1"]);
  });

  it("dedupes, keeping the first position", () => {
    const folded = { a: "layer:row", b: "layer:row" };
    expect(translateWaivers(["x", "a", "b", "layer:row", "x"], folded)).toEqual(["x", "layer:row"]);
  });

  it("does not treat inherited object keys as mappings", () => {
    expect(translateWaivers(["constructor", "toString"], {})).toEqual(["constructor", "toString"]);
  });

  it("returns an empty list for no waivers", () => {
    expect(translateWaivers([], map)).toEqual([]);
  });
});
