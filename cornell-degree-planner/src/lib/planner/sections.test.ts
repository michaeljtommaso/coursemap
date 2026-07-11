import { describe, it, expect } from "vitest";
import {
  primarySection,
  sectionInstructorNames,
  parseDayTokens,
  parseClockToMinutes,
  formatClock,
  formatMeetingChip,
  openStatusKind,
  openStatusWord,
  gradingBasisAllowsSU,
  componentNote,
} from "./sections";
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

describe("primarySection", () => {
  it("prefers the first LEC, else the first section", () => {
    const dis = section({ code: "DIS 201", component: "DIS" });
    const lec = section({ code: "LEC 001", component: "LEC" });
    expect(primarySection([dis, lec])?.code).toBe("LEC 001");
    expect(primarySection([dis])?.code).toBe("DIS 201"); // no LEC → first
    expect(primarySection([])).toBeNull();
  });
});

describe("sectionInstructorNames", () => {
  it("dedupes and joins first + last", () => {
    const s = section({
      instructors: [
        { netid: "ab1", firstName: "Ada", lastName: "Lovelace" },
        { netid: "ab1", firstName: "Ada", lastName: "Lovelace" }, // dup
        { netid: "gh2", firstName: "Grace", lastName: "Hopper" },
      ],
    });
    expect(sectionInstructorNames(s)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});

describe("parseDayTokens", () => {
  it("TR → [T, R]; R is Thursday (Cornell)", () => {
    expect(parseDayTokens("TR")).toEqual(["T", "R"]);
  });
  it("MWF splits into three", () => {
    expect(parseDayTokens("MWF")).toEqual(["M", "W", "F"]);
  });
  it("Su is read before S (Sunday vs Saturday)", () => {
    expect(parseDayTokens("Su")).toEqual(["Su"]);
    expect(parseDayTokens("SSu")).toEqual(["S", "Su"]);
    expect(parseDayTokens("S")).toEqual(["S"]);
  });
  it("skips separators / unknown chars", () => {
    expect(parseDayTokens("M W F")).toEqual(["M", "W", "F"]);
    expect(parseDayTokens("")).toEqual([]);
  });
});

describe("parseClockToMinutes / formatClock", () => {
  it("parses 12-hour clock with meridian", () => {
    expect(parseClockToMinutes("10:10AM")).toBe(10 * 60 + 10);
    expect(parseClockToMinutes("1:25PM")).toBe(13 * 60 + 25);
    expect(parseClockToMinutes("12:00PM")).toBe(12 * 60); // noon
    expect(parseClockToMinutes("12:30AM")).toBe(30); // midnight hour
  });
  it("returns null for garbage", () => {
    expect(parseClockToMinutes("")).toBeNull();
    expect(parseClockToMinutes("10:10")).toBeNull(); // no meridian
    expect(parseClockToMinutes("25:00AM")).toBeNull();
  });
  it("formatClock renders 12-hour, no meridian, no leading zero", () => {
    expect(formatClock(10 * 60 + 10)).toBe("10:10");
    expect(formatClock(13 * 60 + 25)).toBe("1:25");
    expect(formatClock(12 * 60)).toBe("12:00");
    expect(formatClock(0)).toBe("12:00");
  });
});

describe("formatMeetingChip", () => {
  it("builds 'TR 10:10–11:25' from the first well-formed meeting", () => {
    const s = section({
      meetings: [{ pattern: "TR", timeStart: "10:10AM", timeEnd: "11:25AM" }],
    });
    expect(formatMeetingChip(s)).toBe("TR 10:10–11:25");
  });
  it("skips meetings missing a pattern or times, returns null when none usable", () => {
    const s = section({
      meetings: [
        { pattern: "", timeStart: "10:10AM", timeEnd: "11:25AM" },
        { pattern: "MWF", timeStart: "", timeEnd: "" },
      ],
    });
    expect(formatMeetingChip(s)).toBeNull();
  });
});

describe("openStatusKind / openStatusWord", () => {
  it("maps O/W/C, else null", () => {
    expect(openStatusKind("O")).toBe("open");
    expect(openStatusKind("W")).toBe("waitlist");
    expect(openStatusKind("C")).toBe("closed");
    expect(openStatusKind("Open")).toBe("open");
    expect(openStatusKind(null)).toBeNull();
    expect(openStatusKind("X")).toBeNull();
  });
  it("word form", () => {
    expect(openStatusWord("O")).toBe("Open");
    expect(openStatusWord("W")).toBe("Waitlist");
    expect(openStatusWord(null)).toBeNull();
  });
});

describe("gradingBasisAllowsSU", () => {
  it("true for OPT/OPI/SUS, false for GRD/unknown/absent", () => {
    expect(gradingBasisAllowsSU("OPT")).toBe(true);
    expect(gradingBasisAllowsSU("OPI")).toBe(true);
    expect(gradingBasisAllowsSU("SUS")).toBe(true);
    expect(gradingBasisAllowsSU("GRD")).toBe(false);
    expect(gradingBasisAllowsSU(null)).toBe(false);
    expect(gradingBasisAllowsSU("")).toBe(false);
  });
});

describe("componentNote", () => {
  it("names the extra components beyond the lecture", () => {
    expect(componentNote(["LEC", "DIS"])).toBe("also requires a discussion section");
    expect(componentNote(["LEC", "LAB"])).toBe("also requires a lab");
    expect(componentNote(["LEC", "DIS", "LAB"])).toBe(
      "also requires a discussion section and lab"
    );
  });
  it("null when nothing beyond a lecture / unrecognized", () => {
    expect(componentNote(["LEC"])).toBeNull();
    expect(componentNote([])).toBeNull();
    expect(componentNote(["LEC", "ZZZ"])).toBeNull();
  });
});
