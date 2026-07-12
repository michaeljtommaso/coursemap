// scripts/roster-convert.corpus.ts
// Asserted, offline corpus runner for roster-convert.ts (spec 010 §1/§3/§5/§7,
// Unit 10A — crseAttrs + enrollGroups ingest). NO network calls — every fixture
// below is a hand-built object shaped like the live API (verified nesting, see
// roster-convert.ts file header). Exits nonzero on any mismatch, same contract
// as scripts/forbidden-overlaps.corpus.ts.
//
// Run: npx tsx roster-convert.corpus.ts   (from the scripts/ folder)

import {
  newConvertStats,
  rowToCourse,
  type ClassRow,
  type CourseUpsert,
} from "./roster-convert";
import { buildIndexRecords } from "./catalog-index";

type Check = {
  name: string;
  fn: () => void;
};

const checks: Check[] = [];
let failures = 0;

function check(name: string, fn: () => void) {
  checks.push({ name, fn });
}

function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail(name, `expected ${e}, got ${a}`);
  }
}

function assertTrue(name: string, cond: boolean, detail: string) {
  if (!cond) fail(name, detail);
}

// ── A full CS-2110-like row: attrs + 2 sections with instructors/meetings ────
// Shaped after the live probe (spec 010 decision 2, roster FA26, subject CS,
// 2026-07-11): instructors nest under meetings, gradingBasis/componentsRequired
// are group-level.

const cs2110Row: ClassRow = {
  subject: "CS",
  catalogNbr: "2110",
  titleLong: "Object-Oriented Programming and Data Structures",
  description: "Intermediate programming in a high-level language.",
  lastTermsOffered: "26FA,26SP", // parseOffered matches on the term SUFFIX ("FA"/"SP"/"SU"/"WI")
  crseId: 12345,
  crseAttrs: [
    { crseAttrValue: "SMR-AS", descr: "AS-Symbolic & Mathematic Rsng", attrDescr: "Distribution Requirements" },
    { crseAttrValue: "STA-IL", descr: "IL-Statistics Requirement", attrDescr: "Distribution Requirements" },
  ],
  enrollGroups: [
    {
      unitsMinimum: 4,
      unitsMaximum: 4,
      gradingBasis: "OPT",
      componentsRequired: ["LEC", "DIS"],
      componentsOptional: [],
      classSections: [
        {
          ssrComponent: "LEC",
          section: "001",
          classNbr: 17258,
          openStatus: "O",
          instructionMode: "P",
          meetings: [
            {
              pattern: "TR",
              timeStart: "10:10AM",
              timeEnd: "11:25AM",
              instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }],
            },
          ],
        },
        {
          ssrComponent: "DIS",
          section: "201",
          classNbr: 17259,
          openStatus: "O",
          instructionMode: "P",
          meetings: [
            {
              pattern: "T",
              timeStart: "11:40AM",
              timeEnd: "12:55PM",
              instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }],
            },
          ],
        },
      ],
    },
  ],
  catalogPrereq: "CS 1110 or 1112",
  catalogCoreq: null,
  catalogPrereqCoreq: null,
  catalogForbiddenOverlaps: null,
};

const expectedCs2110: CourseUpsert = {
  id: "CS-2110",
  subject: "CS",
  number: "2110",
  title: "Object-Oriented Programming and Data Structures",
  creditsMin: 4,
  creditsMax: 4,
  description: "Intermediate programming in a high-level language.",
  offered: ["FA", "SP"],
  // ⚠️ naming trap (root-caused 2026-07-11): rosterId is the NUMERIC crseId,
  // NOT the slug — the slug lives in `roster` below and is what the app's
  // horizon gates compare to enrollmentTarget.
  rosterId: "12345",
  roster: "FA26",
  prereqText: "CS 1110 or 1112",
  coreqText: null,
  forbiddenOverlaps: null,
  attrs: [
    { value: "SMR-AS", descr: "AS-Symbolic & Mathematic Rsng", group: "Distribution Requirements" },
    { value: "STA-IL", descr: "IL-Statistics Requirement", group: "Distribution Requirements" },
  ],
  sections: [
    {
      code: "LEC 001",
      component: "LEC",
      openStatus: "O",
      gradingBasis: "OPT",
      components: ["LEC", "DIS"],
      instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }],
      meetings: [{ pattern: "TR", timeStart: "10:10AM", timeEnd: "11:25AM" }],
    },
    {
      code: "DIS 201",
      component: "DIS",
      openStatus: "O",
      gradingBasis: "OPT",
      components: ["LEC", "DIS"],
      instructors: [{ netid: "al123", firstName: "Ada", lastName: "Lovelace" }],
      meetings: [{ pattern: "T", timeStart: "11:40AM", timeEnd: "12:55PM" }],
    },
  ],
  components: ["LEC", "DIS"],
};

check("CS-2110-like row — exact expected CourseUpsert (attrs + 2 sections)", () => {
  const out = rowToCourse(cs2110Row, "FA26", newConvertStats());
  assertEqual("CS-2110 full row", out, expectedCs2110);
});

// ── roster vs rosterId (the 2026-07-11 naming-trap root cause) ───────────────
// rosterId is Cornell's NUMERIC crseId; `roster` is the sync's SLUG and is the
// field the app's horizon gates compare to enrollmentTarget. Both are asserted
// explicitly so a regression that swaps or drops either is caught here.

check("roster is ALWAYS the sync slug; rosterId stays the numeric crseId", () => {
  const out = rowToCourse(cs2110Row, "FA26", newConvertStats());
  assertEqual("roster carries the slug", out?.roster, "FA26");
  assertEqual("rosterId carries the crseId (naming trap — never the slug)", out?.rosterId, "12345");
  assertTrue(
    "rosterId must never equal the slug shape",
    out?.rosterId !== out?.roster,
    "rosterId and roster collided — the naming trap regressed"
  );
});

check("row without crseId → rosterId null, roster STILL written (always-written contract)", () => {
  const row: ClassRow = {
    subject: "CS",
    catalogNbr: "1110",
    titleLong: "Introduction to Computing",
    enrollGroups: [{ unitsMinimum: 4, unitsMaximum: 4 }],
    // no crseId
  };
  const out = rowToCourse(row, "SP27", newConvertStats());
  assertEqual("rosterId null without crseId", out?.rosterId, null);
  assertEqual("roster still written from the threaded slug", out?.roster, "SP27");
});

// ── Empty enrollGroups → null credits path (row skipped, unchanged behavior) ─

check("empty enrollGroups → row skipped (null)", () => {
  const row: ClassRow = {
    subject: "CS",
    catalogNbr: "9999",
    titleLong: "Placeholder",
    enrollGroups: [],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("empty enrollGroups", out, null);
});

// ── crseAttrs entries missing crseAttrValue → skipped entries ────────────────

check("crseAttrs entries missing crseAttrValue are skipped", () => {
  const row: ClassRow = {
    subject: "ENGL",
    catalogNbr: "1134",
    titleLong: "FWS: True Stories",
    enrollGroups: [{ unitsMinimum: 3, unitsMaximum: 3 }],
    crseAttrs: [
      { crseAttrValue: "ALC-AS", descr: "Arts, Lit & Culture", attrDescr: "Distribution Requirements" },
      { descr: "no value on this one", attrDescr: "Distribution Requirements" }, // missing crseAttrValue
      { crseAttrValue: "", descr: "empty value", attrDescr: "Distribution Requirements" }, // blank value
    ],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("attrs with missing crseAttrValue skipped", out?.attrs, [
    { value: "ALC-AS", descr: "Arts, Lit & Culture", group: "Distribution Requirements" },
  ]);
});

check("crseAttrs deduped by value", () => {
  const row: ClassRow = {
    subject: "ENGL",
    catalogNbr: "1130",
    titleLong: "FWS: Writing the Environment",
    enrollGroups: [{ unitsMinimum: 3, unitsMaximum: 3 }],
    crseAttrs: [
      { crseAttrValue: "ALC-AS", descr: "Arts, Lit & Culture", attrDescr: "Distribution Requirements" },
      { crseAttrValue: "ALC-AS", descr: "Arts, Lit & Culture (dup)", attrDescr: "Distribution Requirements" },
    ],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("attrs deduped by value (first wins)", out?.attrs, [
    { value: "ALC-AS", descr: "Arts, Lit & Culture", group: "Distribution Requirements" },
  ]);
});

// ── Meetings with missing times → dropped ────────────────────────────────────

check("meetings with missing times are dropped", () => {
  const row: ClassRow = {
    subject: "MATH",
    catalogNbr: "1910",
    titleLong: "Calculus for Engineers",
    enrollGroups: [
      {
        unitsMinimum: 4,
        unitsMaximum: 4,
        classSections: [
          {
            ssrComponent: "LEC",
            section: "001",
            meetings: [
              { pattern: "MWF", timeStart: "9:05AM", timeEnd: "9:55AM" }, // kept
              { pattern: "MWF", timeStart: "9:05AM" }, // missing timeEnd — dropped
              { timeStart: "9:05AM", timeEnd: "9:55AM" }, // missing pattern — dropped
            ],
          },
        ],
      },
    ],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("only the fully-populated meeting survives", out?.sections?.[0]?.meetings, [
    { pattern: "MWF", timeStart: "9:05AM", timeEnd: "9:55AM" },
  ]);
});

// ── Instructor missing netid → kept with name-key dedupe ────────────────────

check("instructor missing netid is kept (netid \"\") and deduped by name key", () => {
  const row: ClassRow = {
    subject: "CS",
    catalogNbr: "3110",
    titleLong: "Data Structures and Functional Programming",
    enrollGroups: [
      {
        unitsMinimum: 4,
        unitsMaximum: 4,
        classSections: [
          {
            ssrComponent: "LEC",
            section: "001",
            meetings: [
              {
                pattern: "MW",
                timeStart: "1:25PM",
                timeEnd: "2:15PM",
                instructors: [{ firstName: "Jane", lastName: "Doe" }], // no netid
              },
              {
                pattern: "F",
                timeStart: "1:25PM",
                timeEnd: "2:15PM",
                instructors: [{ firstName: "Jane", lastName: "Doe" }], // same person, no netid — dedupe
              },
            ],
          },
        ],
      },
    ],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("single deduped instructor with netid \"\"", out?.sections?.[0]?.instructors, [
    { netid: "", firstName: "Jane", lastName: "Doe" },
  ]);
});

// ── Section cap overflow → capped ────────────────────────────────────────────

check("more than 60 sections in one course are capped at 60, drops counted", () => {
  const classSections = Array.from({ length: 65 }, (_, i) => ({
    ssrComponent: "LEC",
    section: String(i + 1).padStart(3, "0"),
    meetings: [],
  }));
  const row: ClassRow = {
    subject: "TEST",
    catalogNbr: "0001",
    titleLong: "Section Cap Stress Test",
    enrollGroups: [{ unitsMinimum: 1, unitsMaximum: 1, classSections }],
  };
  const stats = newConvertStats();
  const out = rowToCourse(row, "FA26", stats);
  assertEqual("sections capped at 60", out?.sections?.length, 60);
  assertEqual("5 sections dropped, counted in stats", stats.sectionCapDrops, 5);
});

check("more than 10 instructors in one section are capped at 10, drops counted", () => {
  const instructors = Array.from({ length: 13 }, (_, i) => ({
    netid: `netid${i}`,
    firstName: `First${i}`,
    lastName: `Last${i}`,
  }));
  const row: ClassRow = {
    subject: "TEST",
    catalogNbr: "0002",
    titleLong: "Instructor Cap Stress Test",
    enrollGroups: [
      {
        unitsMinimum: 1,
        unitsMaximum: 1,
        classSections: [
          {
            ssrComponent: "LEC",
            section: "001",
            meetings: [{ pattern: "M", timeStart: "9:00AM", timeEnd: "9:50AM", instructors }],
          },
        ],
      },
    ],
  };
  const stats = newConvertStats();
  const out = rowToCourse(row, "FA26", stats);
  assertEqual("instructors capped at 10", out?.sections?.[0]?.instructors.length, 10);
  assertEqual("3 instructors dropped, counted in stats", stats.instructorCapDrops, 3);
});

check("more than 10 meetings in one section are capped at 10, drops counted", () => {
  const meetings = Array.from({ length: 12 }, (_, i) => ({
    pattern: "M",
    timeStart: `${9 + i}:00AM`,
    timeEnd: `${9 + i}:50AM`,
  }));
  const row: ClassRow = {
    subject: "TEST",
    catalogNbr: "0003",
    titleLong: "Meeting Cap Stress Test",
    enrollGroups: [
      {
        unitsMinimum: 1,
        unitsMaximum: 1,
        classSections: [{ ssrComponent: "LEC", section: "001", meetings }],
      },
    ],
  };
  const stats = newConvertStats();
  const out = rowToCourse(row, "FA26", stats);
  assertEqual("meetings capped at 10", out?.sections?.[0]?.meetings.length, 10);
  assertEqual("2 meetings dropped, counted in stats", stats.meetingCapDrops, 2);
});

// ── No crseAttrs / no enrollGroups sections → attrs/sections/components null ─

check("row with no crseAttrs → attrs is null", () => {
  const row: ClassRow = {
    subject: "MATH",
    catalogNbr: "1920",
    titleLong: "Multivariable Calculus for Engineers",
    enrollGroups: [{ unitsMinimum: 4, unitsMaximum: 4 }],
  };
  const out = rowToCourse(row, "FA26", newConvertStats());
  assertEqual("no attrs", out?.attrs, null);
  assertEqual("no classSections → sections null", out?.sections, null);
  assertEqual("no componentsRequired → components null", out?.components, null);
});

// ── FWS-titled row → index-side fws flag true via buildIndexRecords ─────────
// catalog-index.ts's buildIndexRecords only imports firebase-admin as a TYPE
// (`import type { Firestore, WriteBatch }`), which tsx elides at runtime — it
// is genuinely pure/importable here, so the flag is tested where it lives
// rather than re-implemented.

check("FWS-titled course doc → fws: true in buildIndexRecords", () => {
  const records = buildIndexRecords([
    {
      id: "ENGL-1134",
      subject: "ENGL",
      number: "1134",
      title: "FWS: True Stories",
      creditsMin: 3,
      creditsMax: 3,
      prereqExpr: null,
      offered: ["FA"],
      attrs: [
        { value: "ALC-AS", descr: "Arts, Lit & Culture", group: "Distribution Requirements" },
        { value: "HST-AS", descr: "Historical Analysis", group: "Distribution Requirements" },
      ],
    },
    {
      id: "CS-2110",
      subject: "CS",
      number: "2110",
      title: "Object-Oriented Programming and Data Structures",
      creditsMin: 4,
      creditsMax: 4,
      prereqExpr: null,
      offered: ["FA", "SP"],
      attrs: [{ value: "SMR-AS", descr: "AS-Symbolic & Mathematic Rsng", group: "Distribution Requirements" }],
    },
  ]);
  const fws = records.find((r) => r.id === "ENGL-1134");
  const nonFws = records.find((r) => r.id === "CS-2110");
  assertTrue("FWS title flips fws: true", fws?.fws === true, `got ${JSON.stringify(fws)}`);
  assertTrue("non-FWS title stays fws: false", nonFws?.fws === false, `got ${JSON.stringify(nonFws)}`);
  assertEqual("attrs values carried through (capped at 40)", fws?.attrs, ["ALC-AS", "HST-AS"]);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── roster-convert corpus — ${checks.length} case(s) ──`);
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
}

console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
