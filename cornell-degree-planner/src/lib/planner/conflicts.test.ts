import { describe, it, expect } from "vitest";
import { findConflicts, type ConflictPlacement } from "./conflicts";
import type { CourseSection } from "@/types/db";

function section(over: Partial<CourseSection> = {}): CourseSection {
  return {
    code: "LEC 001",
    component: "LEC",
    openStatus: null,
    gradingBasis: null,
    components: [],
    instructors: [],
    meetings: [],
    ...over,
  };
}

function placement(
  id: string,
  sections: CourseSection[],
  over: Partial<ConflictPlacement> = {}
): ConflictPlacement {
  return {
    slotId: `slot-${id}`,
    courseId: `${id}-01`,
    courseCode: id,
    sections,
    ...over,
  };
}

const lec = (pattern: string, timeStart: string, timeEnd: string, over: Partial<CourseSection> = {}) =>
  section({ meetings: [{ pattern, timeStart, timeEnd }], ...over });

describe("findConflicts", () => {
  it("flags a shared-day overlapping range (both directions represented once)", () => {
    const a = placement("CS 2110", [lec("TR", "10:10AM", "11:25AM")]);
    const b = placement("CS 2800", [lec("TR", "11:00AM", "12:15PM")]);
    const out = findConflicts([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].aSlotId).toBe("slot-CS 2110");
    expect(out[0].bSlotId).toBe("slot-CS 2800");
    expect(out[0].overlap.days.sort()).toEqual(["R", "T"]);
    expect(out[0].overlap.timeRange).toBe("11:00–11:25"); // intersection window
  });

  it("no conflict when days don't overlap (MWF vs TR)", () => {
    const a = placement("A", [lec("MWF", "10:00AM", "10:50AM")]);
    const b = placement("B", [lec("TR", "10:00AM", "11:00AM")]);
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it("distinguishes TR from separate T + R meetings but still finds the shared day", () => {
    const a = placement("A", [lec("TR", "10:00AM", "11:00AM")]);
    // B meets Tuesday only, overlapping time → conflict on T alone.
    const b = placement("B", [lec("T", "10:30AM", "11:30AM")]);
    const out = findConflicts([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].overlap.days).toEqual(["T"]);
  });

  it("contained range (one inside the other) conflicts", () => {
    const a = placement("A", [lec("M", "10:00AM", "12:00PM")]);
    const b = placement("B", [lec("M", "10:30AM", "11:00AM")]);
    expect(findConflicts([a, b])).toHaveLength(1);
  });

  it("touching-but-not-overlapping boundaries do NOT conflict (half-open)", () => {
    const a = placement("A", [lec("M", "10:00AM", "11:00AM")]);
    const b = placement("B", [lec("M", "11:00AM", "12:00PM")]);
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it("missing/garbled meeting data is skipped silently (no conflict, no throw)", () => {
    const a = placement("A", [lec("", "10:00AM", "11:00AM")]); // no days
    const b = placement("B", [lec("M", "", "")]); // no times
    const c = placement("C", []); // no sections at all
    expect(findConflicts([a, b, c])).toHaveLength(0);
  });

  it("uses the PRIMARY section only (v1) — a non-primary DIS collision is ignored", () => {
    // A's primary LEC is MWF (no collision with B); A also has a DIS on TR that
    // WOULD collide with B — v1 must ignore it (primary sections only).
    const aLec = section({ code: "LEC 001", component: "LEC", meetings: [{ pattern: "MWF", timeStart: "9:00AM", timeEnd: "9:50AM" }] });
    const aDis = section({ code: "DIS 201", component: "DIS", meetings: [{ pattern: "TR", timeStart: "10:00AM", timeEnd: "11:00AM" }] });
    const a = placement("A", [aLec, aDis]);
    const b = placement("B", [lec("TR", "10:00AM", "11:00AM")]);
    expect(findConflicts([a, b])).toHaveLength(0);

    // But when A's LEC itself collides with B, it IS flagged.
    const a2 = placement("A", [lec("TR", "10:00AM", "11:00AM"), aDis]);
    expect(findConflicts([a2, b])).toHaveLength(1);
  });

  it("three mutually-colliding courses yield all three pairs", () => {
    const a = placement("A", [lec("MWF", "10:00AM", "11:00AM")]);
    const b = placement("B", [lec("MWF", "10:30AM", "11:30AM")]);
    const c = placement("C", [lec("MWF", "10:15AM", "10:45AM")]);
    expect(findConflicts([a, b, c])).toHaveLength(3);
  });
});
