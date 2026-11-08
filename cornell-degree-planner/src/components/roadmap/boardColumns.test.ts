import { describe, expect, it } from "vitest";
import {
  addShortTermLabel,
  boardColumnTargets,
  columnName,
  columnTarget,
  shortTermGapSems,
  termOfYear,
} from "./boardColumns";

// Spec 042 D12 — the column list and names the board's surfaces share.

describe("boardColumnTargets", () => {
  it("is semesters 1–8 in order with no short terms", () => {
    const cols = boardColumnTargets([]);
    expect(cols.map((c) => c.sem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cols.every((c) => !c.shortTerm)).toBe(true);
    expect(cols.map((c) => c.key)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("interleaves short terms by time: the summer before sem 1, the winter before sem 2", () => {
    const cols = boardColumnTargets([], [1, 2]);
    expect(cols.slice(0, 4)).toEqual([
      { sem: 1, shortTerm: true, key: 1 },
      { sem: 1, shortTerm: false, key: 2 },
      { sem: 2, shortTerm: true, key: 3 },
      { sem: 2, shortTerm: false, key: 4 },
    ]);
  });

  it("adds a short term holding a class, and 9–10 only when used", () => {
    const cols = boardColumnTargets([
      { sem: 3, shortTerm: true },
      { sem: 9 },
    ]);
    expect(cols.some((c) => c.sem === 3 && c.shortTerm)).toBe(true);
    expect(cols.some((c) => c.sem === 9 && !c.shortTerm)).toBe(true);
    expect(cols.some((c) => c.sem === 10)).toBe(false);
  });

  it("ignores junk short-term entries and dedupes", () => {
    const cols = boardColumnTargets([], [0, 11, 2.5, 4, 4]);
    expect(cols.filter((c) => c.shortTerm)).toEqual([{ sem: 4, shortTerm: true, key: 7 }]);
  });
});

describe("columnName", () => {
  it("names a semester as before", () => {
    expect(columnName({ sem: 1 }, 2026)).toBe("Fall 2026");
    expect(columnName({ sem: 2 }, 2026)).toBe("Spring 2027");
    expect(columnName({ sem: 3 }, null)).toBe("Fall · Sophomore");
  });

  it("names a short term by its real term", () => {
    expect(columnName({ sem: 1, shortTerm: true }, 2026)).toBe("Summer 2026");
    expect(columnName({ sem: 2, shortTerm: true }, 2026)).toBe("Winter 2027");
  });

  it("anchors a short term to its semester without an entering year", () => {
    expect(columnName({ sem: 3, shortTerm: true }, null)).toBe("Summer · before Sem 3");
  });
});

describe("termOfYear (detail panel)", () => {
  it("keeps semesters year-free", () => {
    expect(termOfYear({ sem: 3 }, 2026)).toBe("Fall of year 2");
  });

  it("names a short-term placement 'Summer 2026'", () => {
    expect(termOfYear({ sem: 3, shortTerm: true }, 2026)).toBe("Summer 2027");
    expect(termOfYear({ sem: 1, shortTerm: true }, 2026)).toBe("Summer 2026");
    expect(termOfYear({ sem: 2, shortTerm: true }, 2026)).toBe("Winter 2027");
  });

  it("falls back to the semester it precedes without a year", () => {
    expect(termOfYear({ sem: 2, shortTerm: true }, null)).toBe("Winter before Spring of year 1");
  });
});

describe("addShortTermLabel", () => {
  it("is the gap's term — summer before a fall, winter before a spring", () => {
    expect(addShortTermLabel(1, 2026)).toBe("Add Summer 2026");
    expect(addShortTermLabel(2, 2026)).toBe("Add Winter 2027");
    expect(addShortTermLabel(4, 2026)).toBe("Add Winter 2028");
  });

  it("is the bare season without an entering year", () => {
    expect(addShortTermLabel(1, null)).toBe("Add summer");
    expect(addShortTermLabel(2, null)).toBe("Add winter");
  });
});

describe("shortTermGapSems", () => {
  const regular = (sem: number) => ({ sem, shortTerm: false });
  const short = (sem: number) => ({ sem, shortTerm: true });

  it("puts a + before every semester, the first included", () => {
    const cols = [1, 2, 3, 4, 5, 6, 7, 8].map(regular);
    expect([...shortTermGapSems(cols, 0)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("hides the + in a gap that already has a short term", () => {
    const cols = [short(1), regular(1), regular(2), short(3), regular(3)];
    expect([...shortTermGapSems(cols, 2)].sort()).toEqual([2]);
  });

  it("hides every + at MAX_SHORT_TERMS (board or stored count)", () => {
    const all = [];
    for (let k = 1; k <= 10; k++) all.push(short(k), regular(k));
    expect(shortTermGapSems(all, 10).size).toBe(0);
    expect(shortTermGapSems([regular(1), regular(2)], 10).size).toBe(0);
    expect(shortTermGapSems([regular(1), regular(2)], 9).size).toBe(2);
  });
});

describe("columnTarget", () => {
  it("is a number for a semester and a ColumnRef for a short term", () => {
    expect(columnTarget({ sem: 4 })).toBe(4);
    expect(columnTarget({ sem: 4, shortTerm: false })).toBe(4);
    expect(columnTarget({ sem: 4, shortTerm: true })).toEqual({ sem: 4, shortTerm: true });
  });
});
