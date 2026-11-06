import { describe, expect, it } from "vitest";
import {
  TIME_CHOICES,
  clockLabel,
  dayTokens,
  fitsSchedule,
  meetingSummary,
  parseMeet,
  parseMeets,
  primaryBlocks,
  type ScheduleQuery,
} from "./schedule";

const q = (over: Partial<ScheduleQuery>): ScheduleQuery => ({ parts: "lecture", ...over });

// 10:10–11:25 TR lecture, M 7:30–8:20 PM discussion.
const CS = parseMeets(["PLEC|TR 610-685", "SDIS|M 1170-1220"]);
// Two lecture times (AEM 1200 shape).
const AEM = parseMeets(["PLEC|MW 610-685", "PLEC|MW 700-775"]);

describe("parsing", () => {
  it("tokenizes days with Su before S", () => {
    expect(dayTokens("TR")).toEqual(["T", "R"]);
    expect(dayTokens("SSu")).toEqual(["S", "Su"]);
    expect(dayTokens("MTWRF")).toEqual(["M", "T", "W", "R", "F"]);
  });

  it("parses role, component and blocks", () => {
    expect(parseMeet("PLEC|TR 545-595,F 805-855")).toEqual({
      primary: true,
      component: "LEC",
      blocks: [
        { days: ["T", "R"], start: 545, end: 595 },
        { days: ["F"], start: 805, end: 855 },
      ],
    });
    expect(parseMeet("PIND|")).toEqual({ primary: true, component: "IND", blocks: [] });
  });

  it("drops what isn't in the grammar, never throws", () => {
    expect(parseMeet("garbage")).toBeNull();
    expect(parseMeet("XLEC|M 1-2")).toBeNull();
    expect(parseMeet("PLEC|M 700-600")?.blocks).toEqual([]);
    expect(parseMeets(["nope", "SDIS|W 600-650"])).toHaveLength(1);
    expect(parseMeets(undefined)).toEqual([]);
  });

  it("primaryBlocks is the first P option", () => {
    expect(primaryBlocks(AEM)).toEqual([{ days: ["M", "W"], start: 610, end: 685 }]);
    expect(primaryBlocks(parseMeets(["SDIS|F 600-650"]))).toEqual([]);
  });
});

describe("fitsSchedule — days (free-day subset)", () => {
  it("a TR class fits T+R and T+W+R, not T alone", () => {
    expect(fitsSchedule(CS, q({ days: ["T", "R"] }))).toBe(true);
    expect(fitsSchedule(CS, q({ days: ["T", "W", "R"] }))).toBe(true);
    expect(fitsSchedule(CS, q({ days: ["T"] }))).toBe(false);
  });

  it("no days ticked narrows nothing", () => {
    expect(fitsSchedule(CS, q({ days: [] }))).toBe(true);
  });

  it("weekend days are their own tokens", () => {
    const sat = parseMeets(["PLEC|S 600-720"]);
    expect(fitsSchedule(sat, q({ days: ["M", "T", "W", "R", "F"] }))).toBe(false);
    expect(fitsSchedule(sat, q({ days: ["S"] }))).toBe(true);
    expect(fitsSchedule(parseMeets(["PLEC|Su 600-720"]), q({ days: ["S"] }))).toBe(false);
  });
});

describe("fitsSchedule — time window", () => {
  it("start at or after from, end at or before to", () => {
    expect(fitsSchedule(CS, q({ from: 600, to: 960 }))).toBe(true);
    expect(fitsSchedule(CS, q({ from: 610 }))).toBe(true); // boundary inclusive
    expect(fitsSchedule(CS, q({ from: 615 }))).toBe(false);
    expect(fitsSchedule(CS, q({ to: 685 }))).toBe(true);
    expect(fitsSchedule(CS, q({ to: 680 }))).toBe(false);
  });

  it("any one lecture time fitting is enough", () => {
    expect(fitsSchedule(AEM, q({ from: 690 }))).toBe(true); // 11:40 option
    expect(fitsSchedule(AEM, q({ to: 690 }))).toBe(true); // 10:10 option
    expect(fitsSchedule(AEM, q({ from: 690, to: 700 }))).toBe(false);
  });

  it("every meeting of an option must fit", () => {
    const twoPart = parseMeets(["PLEC|TR 545-595,F 805-855"]);
    expect(fitsSchedule(twoPart, q({ to: 720 }))).toBe(false);
    expect(fitsSchedule(twoPart, q({ days: ["T", "R"] }))).toBe(false);
  });
});

describe("fitsSchedule — which parts", () => {
  it("lecture ignores the evening discussion", () => {
    expect(fitsSchedule(CS, q({ to: 1020, parts: "lecture" }))).toBe(true);
  });

  it("section checks only the discussion", () => {
    expect(fitsSchedule(CS, q({ to: 1020, parts: "section" }))).toBe(false);
    expect(fitsSchedule(CS, q({ days: ["M"], parts: "section" }))).toBe(true);
  });

  it("all needs both", () => {
    expect(fitsSchedule(CS, q({ to: 1020, parts: "all" }))).toBe(false);
    expect(fitsSchedule(CS, q({ days: ["M", "T", "R"], parts: "all" }))).toBe(true);
  });

  it("needs one fitting option per other component", () => {
    const lab = parseMeets(["PLEC|MW 610-660", "SDIS|F 610-660", "SLAB|T 1170-1290", "SLAB|R 840-960"]);
    expect(fitsSchedule(lab, q({ to: 1020, parts: "all" }))).toBe(true);
    // No lab on M/W/F: both lab options (T, R) are out.
    expect(fitsSchedule(lab, q({ days: ["M", "W", "F"], parts: "all" }))).toBe(false);
    // The evening T lab is out by time, the R lab still fits.
    expect(fitsSchedule(lab, q({ days: ["M", "W", "F", "T", "R"], to: 1000, parts: "all" }))).toBe(true);
  });

  it("a class with no discussion or lab passes the section check", () => {
    expect(fitsSchedule(AEM, q({ to: 600, parts: "section" }))).toBe(true);
  });

  it("an untimed other component has nothing to clash", () => {
    const withInd = parseMeets(["PLEC|MW 610-660", "SIND|"]);
    expect(fitsSchedule(withInd, q({ to: 700, parts: "all" }))).toBe(true);
  });
});

describe("fitsSchedule — no set time, no claim", () => {
  it("a course with no times never fits", () => {
    expect(fitsSchedule(parseMeets(["PIND|"]), q({}))).toBe(false);
    expect(fitsSchedule([], q({ parts: "section" }))).toBe(false);
  });

  it("an untimed lecture can't be claimed to fit", () => {
    const tbaLec = parseMeets(["PLEC|", "SDIS|M 600-650"]);
    expect(fitsSchedule(tbaLec, q({ parts: "lecture" }))).toBe(false);
    expect(fitsSchedule(tbaLec, q({ parts: "section" }))).toBe(true);
  });
});

describe("fitsSchedule — around my semester", () => {
  const busy = [{ days: ["T", "R"], start: 600, end: 675 }]; // TR 10:00–11:15

  it("hides a clash, keeps a non-clash", () => {
    expect(fitsSchedule(CS, q({ busy }))).toBe(false);
    expect(fitsSchedule(AEM, q({ busy }))).toBe(true); // MW, no shared day
  });

  it("touching meetings don't clash (half-open)", () => {
    expect(fitsSchedule(parseMeets(["PLEC|TR 675-750"]), q({ busy }))).toBe(true);
  });

  it("one non-clashing lecture option is enough", () => {
    const two = parseMeets(["PLEC|TR 610-685", "PLEC|TR 800-875"]);
    expect(fitsSchedule(two, q({ busy }))).toBe(true);
  });
});

describe("display helpers", () => {
  it("summarizes the first timed lecture option", () => {
    expect(meetingSummary(CS)).toEqual({ label: "TR 10:10–11:25", more: 0 });
    expect(meetingSummary(AEM)).toEqual({ label: "MW 10:10–11:25", more: 1 });
    expect(meetingSummary(parseMeets(["PLEC|", "PLEC|F 780-830"]))).toEqual({ label: "F 1:00–1:50", more: 0 });
    expect(meetingSummary(parseMeets(["PIND|", "SDIS|M 600-650"]))).toBeNull();
  });

  it("with a filter on, leads with the lecture option that fits it", () => {
    expect(meetingSummary(AEM, q({ from: 690, to: 780 }))).toEqual({ label: "MW 11:40–12:55", more: 1 });
    expect(meetingSummary(AEM, q({ to: 690 }))).toEqual({ label: "MW 10:10–11:25", more: 1 });
    expect(meetingSummary(AEM, null)).toEqual({ label: "MW 10:10–11:25", more: 1 });
  });

  it("labels clock times and offers 7 AM to 10 PM in 15-minute steps", () => {
    expect(clockLabel(610)).toBe("10:10 AM");
    expect(clockLabel(720)).toBe("12:00 PM");
    expect(clockLabel(1290)).toBe("9:30 PM");
    expect(TIME_CHOICES[0]).toBe(420);
    expect(TIME_CHOICES[TIME_CHOICES.length - 1]).toBe(1320);
    expect(TIME_CHOICES).toHaveLength(61);
  });
});
