import { describe, it, expect } from "vitest";
import { buildReplacePlan } from "./replaceUndo";

describe("buildReplacePlan", () => {
  it("replace on an occupied slot — undo restores the incumbent", () => {
    const prev = { "slot-a": "CS-2110" };
    const plan = buildReplacePlan(prev, "slot-a", "CS-3110");
    expect(plan.isReplace).toBe(true);
    expect(plan.incumbentCourseId).toBe("CS-2110");
    expect(plan.vacatedSlotId).toBeNull();
    // Undo puts CS-2110 back in slot-a (CS-3110 came from the catalog → leaves).
    expect(plan.undoSelections).toEqual({ "slot-a": "CS-2110" });
  });

  it("moving a placed course onto an occupied slot — undo restores BOTH slots", () => {
    const prev = { "slot-a": "CS-2110", "slot-b": "CS-3110" };
    // Drag CS-3110 (in slot-b) onto slot-a (holding CS-2110).
    const plan = buildReplacePlan(prev, "slot-a", "CS-3110");
    expect(plan.isReplace).toBe(true);
    expect(plan.incumbentCourseId).toBe("CS-2110");
    expect(plan.vacatedSlotId).toBe("slot-b");
    // Undo: slot-a → CS-2110 (incumbent back), slot-b → CS-3110 (mover back).
    expect(plan.undoSelections).toEqual({ "slot-a": "CS-2110", "slot-b": "CS-3110" });
  });

  it("placing into an EMPTY slot is not a replace (no toast)", () => {
    const plan = buildReplacePlan({}, "slot-a", "CS-2110");
    expect(plan.isReplace).toBe(false);
    expect(plan.incumbentCourseId).toBeNull();
    // Undo clears the slot (it was empty before).
    expect(plan.undoSelections).toEqual({ "slot-a": null });
  });

  it("moving a placed course into an EMPTY slot restores its source on undo", () => {
    const prev = { "slot-b": "CS-3110" };
    const plan = buildReplacePlan(prev, "slot-a", "CS-3110");
    expect(plan.isReplace).toBe(false); // target was empty
    expect(plan.vacatedSlotId).toBe("slot-b");
    expect(plan.undoSelections).toEqual({ "slot-a": null, "slot-b": "CS-3110" });
  });

  it("dropping a course onto the slot it already occupies is a no-op (not a replace)", () => {
    const prev = { "slot-a": "CS-2110" };
    const plan = buildReplacePlan(prev, "slot-a", "CS-2110");
    expect(plan.isReplace).toBe(false);
    expect(plan.vacatedSlotId).toBeNull();
  });
});
