import { describe, it, expect } from "vitest";
import { rankSearch, parseCodeQuery, scoreRecord } from "./rankSearch";
import type { CatalogIndexRecord } from "@/lib/schemas";

function rec(id: string, title: string): CatalogIndexRecord {
  const dash = id.lastIndexOf("-");
  return {
    id,
    subject: id.slice(0, dash),
    number: id.slice(dash + 1),
    title,
    creditsMin: 3,
    creditsMax: 4,
    hasPrereqs: false,
    offered: [],
    attrs: [],
    fws: false,
    unlocks: [],
  } as CatalogIndexRecord;
}

// Index order, as the build pipeline writes it (subject A→Z, then number).
// The AEM titles are why "CS" used to open on AEM: "ethiCS", "statistiCS".
const INDEX: CatalogIndexRecord[] = [
  rec("AEM-2010", "Business Ethics"),
  rec("AEM-2100", "Introductory Statistics"),
  rec("ASTRO-1101", "Astrophysics and the Cosmos"),
  rec("BCS-3302", "Brain and Cognitive Science Lab"),
  rec("CS-1110", "Introduction to Computing: A Design and Development Perspective"),
  rec("CS-2110", "Object-Oriented Programming and Data Structures"),
  rec("CS-2800", "Mathematical Foundations of Computing"),
  rec("CS-3110", "Data Structures and Functional Programming"),
  rec("CS-3410", "Computer System Organization and Programming"),
  rec("CS-4410", "Operating Systems"),
  rec("MAE-2030", "Dynamics"),
  rec("MATH-1110", "Calculus I"),
  rec("MATH-1920", "Multivariable Calculus for Engineers"),
  rec("MATH-3110", "Introduction to Analysis"),
  rec("PHYS-1112", "Physics I: Mechanics and Heat"),
];

const ids = (rs: CatalogIndexRecord[]) => rs.map((r) => r.id);

// The pre-K2 matcher, to prove the new ranking never DROPS a result.
function oldMatches(q: string): string[] {
  const t = q.trim();
  const idQ = t.toUpperCase().replace(/\s+/g, "-");
  const titleQ = t.toLowerCase();
  return INDEX.filter(
    (r) => !t || r.id.toUpperCase().includes(idQ) || r.title.toLowerCase().includes(titleQ)
  ).map((r) => r.id);
}

describe("parseCodeQuery", () => {
  it("reads subject, subject+number, compact, dashed and bare-number codes", () => {
    expect(parseCodeQuery("CS")).toEqual({ subject: "CS", number: "" });
    expect(parseCodeQuery("cs 31")).toEqual({ subject: "CS", number: "31" });
    expect(parseCodeQuery("CS-3110")).toEqual({ subject: "CS", number: "3110" });
    expect(parseCodeQuery("cs3110")).toEqual({ subject: "CS", number: "3110" });
    expect(parseCodeQuery("  CS   3110 ")).toEqual({ subject: "CS", number: "3110" });
    expect(parseCodeQuery("3110")).toEqual({ subject: "", number: "3110" });
  });

  it("returns null for multi-word or empty queries", () => {
    expect(parseCodeQuery("")).toBeNull();
    expect(parseCodeQuery("data structures")).toBeNull();
    expect(parseCodeQuery("calculus i")).toBeNull();
  });
});

describe("rankSearch — K2 queries", () => {
  it('"CS 3" ranks CS 3xxx above BCS 3302', () => {
    const out = ids(rankSearch(INDEX, "CS 3"));
    expect(out.slice(0, 2)).toEqual(["CS-3110", "CS-3410"]);
    expect(out.indexOf("BCS-3302")).toBeGreaterThan(out.indexOf("CS-3410"));
    expect(out).not.toContain("CS-4410");
  });

  it('"CS" lists every CS course (by number) before AEM title matches', () => {
    const out = ids(rankSearch(INDEX, "CS"));
    expect(out.slice(0, 6)).toEqual([
      "CS-1110",
      "CS-2110",
      "CS-2800",
      "CS-3110",
      "CS-3410",
      "CS-4410",
    ]);
    expect(out).toContain("AEM-2010");
    expect(out.indexOf("AEM-2010")).toBeGreaterThan(5);
  });

  it('"CS 31" returns CS 31xx first', () => {
    expect(ids(rankSearch(INDEX, "CS 31"))[0]).toBe("CS-3110");
  });

  it("dashed, compact and padded code spellings all find CS 3110 first", () => {
    for (const q of ["CS 3110", "cs-3110", "CS3110", "  cs   3110  "]) {
      expect(ids(rankSearch(INDEX, q))[0]).toBe("CS-3110");
    }
  });

  it("a bare number matches that number across subjects", () => {
    expect(ids(rankSearch(INDEX, "3110"))).toEqual(["CS-3110", "MATH-3110"]);
  });
});

describe("rankSearch — tiers", () => {
  it("exact subject beats subject prefix beats title match", () => {
    const out = ids(rankSearch(INDEX, "MATH"));
    expect(out.slice(0, 3)).toEqual(["MATH-1110", "MATH-1920", "MATH-3110"]);
    expect(out[3]).toBe("CS-2800"); // "Mathematical Foundations…"
  });

  it("subject-prefix matches (MAE, MATH) come before title matches", () => {
    const out = ids(rankSearch(INDEX, "MA"));
    expect(out.slice(0, 4)).toEqual(["MAE-2030", "MATH-1110", "MATH-1920", "MATH-3110"]);
    expect(out).toContain("CS-2800");
    expect(out.indexOf("CS-2800")).toBeGreaterThan(3);
  });

  it("a title word-start match beats a mid-word title match", () => {
    const out = ids(rankSearch(INDEX, "physics"));
    expect(out).toEqual(["PHYS-1112", "ASTRO-1101"]);
  });

  it("numbers sort numerically within a subject", () => {
    const idx = [rec("CS-4999", "Independent Study"), rec("CS-1110", "Intro"), rec("CS-2110", "OOP")];
    expect(ids(rankSearch(idx, "CS"))).toEqual(["CS-1110", "CS-2110", "CS-4999"]);
  });

  it("an empty query returns everything in subject/number order", () => {
    expect(ids(rankSearch([...INDEX].reverse(), ""))).toEqual(ids(INDEX));
  });

  it("never drops a result the old substring search returned", () => {
    for (const q of ["CS", "CS 3", "CS 31", "cs", "ma", "math", "programming", "s", "1", "ics"]) {
      const out = ids(rankSearch(INDEX, q));
      for (const id of oldMatches(q)) expect(out, `${q} → ${id}`).toContain(id);
    }
  });

  it("scoreRecord: Infinity means no match", () => {
    expect(scoreRecord(rec("CS-4410", "Operating Systems"), "CS 3")).toBe(Infinity);
  });
});

describe("rankSearch — cross-listed aliases", () => {
  const aliases = { "ENGRD-2110": "CS-2110" };

  it('"ENGRD 2110" finds the canonical CS 2110 as an exact code match', () => {
    expect(ids(rankSearch(INDEX, "ENGRD 2110", { aliases }))).toEqual(["CS-2110"]);
    expect(ids(rankSearch(INDEX, "ENGRD", { aliases }))[0]).toBe("CS-2110");
  });

  it("without the alias map the cross-listed code finds nothing", () => {
    expect(rankSearch(INDEX, "ENGRD 2110")).toEqual([]);
  });
});

describe("rankSearch — options", () => {
  it("caps results at limit after ranking", () => {
    expect(ids(rankSearch(INDEX, "CS", { limit: 2 }))).toEqual(["CS-1110", "CS-2110"]);
  });

  it("applies filter before ranking", () => {
    const out = ids(rankSearch(INDEX, "CS", { filter: (r) => r.number.startsWith("3") }));
    expect(out).toEqual(["CS-3110", "CS-3410", "BCS-3302"]);
  });
});
