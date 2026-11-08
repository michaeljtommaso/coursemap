import { describe, expect, it } from "vitest";
import { CURRENT_BUILD, isNewBuild, parseVersion, reloadUrl, versionUrl, withoutVersionParam } from "./buildVersion";

describe("buildVersion", () => {
  it("the bundle carries a build id", () => {
    expect(typeof CURRENT_BUILD).toBe("string");
    expect(CURRENT_BUILD.length).toBeGreaterThan(0);
  });

  it("parseVersion reads only a well-formed body", () => {
    expect(parseVersion({ build: "20261108-abc" })).toBe("20261108-abc");
    expect(parseVersion({ build: "" })).toBeNull();
    expect(parseVersion({ build: 3 })).toBeNull();
    expect(parseVersion({ build: "x".repeat(101) })).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("20261108-abc")).toBeNull();
  });

  it("isNewBuild: a different readable id only", () => {
    expect(isNewBuild("a", "b")).toBe(true);
    expect(isNewBuild("a", "a")).toBe(false);
    expect(isNewBuild("a", null)).toBe(false);
  });

  it("reloadUrl adds the live id and keeps the page, query and hash", () => {
    expect(reloadUrl("https://cucoursemap.app/requirements?x=1#top", "B2")).toBe(
      "https://cucoursemap.app/requirements?x=1&v=B2#top"
    );
    expect(reloadUrl("https://cucoursemap.app/?v=OLD", "B2")).toBe("https://cucoursemap.app/?v=B2");
  });

  it("withoutVersionParam strips only the reload's parameter", () => {
    expect(withoutVersionParam("https://cucoursemap.app/classes?v=B2&q=cs#a")).toBe("https://cucoursemap.app/classes?q=cs#a");
    expect(withoutVersionParam("https://cucoursemap.app/?v=B2")).toBe("https://cucoursemap.app/");
    expect(withoutVersionParam("https://cucoursemap.app/classes?q=cs")).toBeNull();
  });

  it("versionUrl is fresh each time", () => {
    expect(versionUrl("https://cucoursemap.app", 123)).toBe("https://cucoursemap.app/version.json?t=123");
  });
});
