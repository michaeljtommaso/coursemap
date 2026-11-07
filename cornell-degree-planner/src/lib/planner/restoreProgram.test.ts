import { describe, expect, it } from "vitest";
import { programToRestore } from "./restoreProgram";

// A signed-in student on a new browser or device (or a new address, like
// cucoursemap.app) has no saved selection in local storage, but their account
// knows their plans: the major comes back from the account instead of first run.

const plans = [
  { id: "p-cs", name: "CS", programId: "cornell-cs-bs-2026" },
  { id: "p-ore", name: "ORIE", programId: "cornell-ore-bs-2026" },
];

describe("programToRestore", () => {
  it("restores the major of the account's active plan", () => {
    expect(programToRestore("p-ore", plans)).toBe("cornell-ore-bs-2026");
  });

  it("falls back to the first plan with a major when the active plan is missing", () => {
    expect(programToRestore("gone", plans)).toBe("cornell-cs-bs-2026");
    expect(programToRestore(null, plans)).toBe("cornell-cs-bs-2026");
  });

  it("skips plans without a major", () => {
    expect(programToRestore("p-x", [{ id: "p-x", programId: "" }, ...plans])).toBe("cornell-cs-bs-2026");
  });

  it("a brand-new account (no plans) restores nothing, so first run shows", () => {
    expect(programToRestore(null, [])).toBeNull();
    expect(programToRestore("p-x", [{ id: "p-x", programId: "" }])).toBeNull();
  });
});
