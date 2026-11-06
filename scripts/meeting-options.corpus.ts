// scripts/meeting-options.corpus.ts
// Asserted, offline corpus runner for the spec 021 `meets` index field built by
// scripts/catalog-index.ts (meetingOptions). NO network calls — every fixture
// is a hand-built course-doc-shaped object. Exits nonzero on any mismatch, same
// contract as scripts/lead-lecturer.corpus.ts.
//
// Run: npx tsx meeting-options.corpus.ts   (from the scripts/ folder)

import { buildIndexRecords, meetingOptions, MEETS_CAP } from "./catalog-index";

const checks: { name: string; fn: () => void }[] = [];
let failures = 0;
const check = (name: string, fn: () => void) => checks.push({ name, fn });
function fail(name: string, message: string) {
  failures++;
  console.error(`  ✗ ${name}\n      ${message}`);
}
function assertEqual<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}

type Mtg = { pattern: string; timeStart: string; timeEnd: string };
const mtg = (pattern: string, timeStart: string, timeEnd: string): Mtg => ({ pattern, timeStart, timeEnd });
const section = (component: string, num: string, meetings: unknown[]) => ({
  code: `${component} ${num}`,
  component,
  openStatus: "O",
  gradingBasis: "GRD",
  components: [],
  instructors: [],
  meetings,
});

check("lecture + discussion, minutes since midnight", () => {
  assertEqual(
    "P lecture, S discussion",
    meetingOptions({
      sections: [
        section("LEC", "001", [mtg("TR", "10:10AM", "11:25AM")]),
        section("DIS", "201", [mtg("M", "07:30PM", "08:20PM")]),
      ],
    }),
    ["PLEC|TR 610-685", "SDIS|M 1170-1220"]
  );
});

check("the primary component is LEC even when a DIS section comes first", () => {
  assertEqual(
    "DIS listed first stays S",
    meetingOptions({
      sections: [section("DIS", "201", [mtg("F", "09:05AM", "09:55AM")]), section("LEC", "001", [mtg("MW", "10:10AM", "11:00AM")])],
    }),
    ["SDIS|F 545-595", "PLEC|MW 610-660"]
  );
});

check("no LEC: the first section's component is primary (seminar)", () => {
  assertEqual(
    "SEM primary",
    meetingOptions({ sections: [section("SEM", "101", [mtg("W", "02:30PM", "04:25PM")])] }),
    ["PSEM|W 870-985"]
  );
});

check("duplicate signatures collapse; distinct lecture times both kept", () => {
  assertEqual(
    "two LEC times, repeated DIS slot once",
    meetingOptions({
      sections: [
        section("LEC", "001", [mtg("MW", "10:10AM", "11:25AM")]),
        section("LEC", "002", [mtg("MW", "11:40AM", "12:55PM")]),
        section("DIS", "201", [mtg("F", "10:10AM", "11:00AM")]),
        section("DIS", "202", [mtg("F", "10:10AM", "11:00AM")]),
      ],
    }),
    ["PLEC|MW 610-685", "PLEC|MW 700-775", "SDIS|F 610-660"]
  );
});

check("a section with several meetings keeps them all, comma-joined", () => {
  assertEqual(
    "LEC TR + F",
    meetingOptions({
      sections: [section("LEC", "001", [mtg("TR", "09:05AM", "09:55AM"), mtg("F", "01:25PM", "02:15PM")])],
    }),
    ["PLEC|TR 545-595,F 805-855"]
  );
});

check("untimed / malformed meetings keep the component with an empty list", () => {
  assertEqual(
    "TBA lecture, bad times, Sunday",
    meetingOptions({
      sections: [
        section("IND", "601", []),
        section("LAB", "401", [mtg("", "", ""), mtg("R", "2:00PM", "1:00PM"), mtg("SSu", "10:00AM", "12:00PM")]),
      ],
    }),
    ["PIND|", "SLAB|SSu 600-720"]
  );
});

check("noon and midnight edges", () => {
  assertEqual(
    "12:20PM = 740, 12:00AM-01:00AM = 0-60",
    meetingOptions({
      sections: [section("LEC", "001", [mtg("M", "12:20PM", "01:10PM")]), section("DIS", "1", [mtg("T", "12:00AM", "01:00AM")])],
    }),
    ["PLEC|M 740-790", "SDIS|T 0-60"]
  );
});

check("no sections → [] ; garbage sections never throw", () => {
  assertEqual("no sections", meetingOptions({}), []);
  assertEqual("garbage", meetingOptions({ sections: [null, 5, { meetings: "x" }] }), ["P|"]);
});

check("capped at MEETS_CAP entries", () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    section("DIS", String(200 + i), [mtg("M", "08:00AM", `09:${String(i).padStart(2, "0")}AM`)])
  );
  const out = meetingOptions({ sections: [section("LEC", "001", [mtg("TR", "10:10AM", "11:25AM")]), ...many] });
  assertEqual("length", out.length, MEETS_CAP);
  assertEqual("primary first", out[0], "PLEC|TR 610-685");
});

check("buildIndexRecords carries meets", () => {
  const [r] = buildIndexRecords([
    {
      id: "CS-1110",
      subject: "CS",
      number: "1110",
      title: "Intro",
      creditsMin: 4,
      creditsMax: 4,
      prereqExpr: null,
      sections: [section("LEC", "001", [mtg("TR", "09:05AM", "09:55AM")])],
    },
  ]);
  assertEqual("meets", r.meets, ["PLEC|TR 545-595"]);
});

console.log(`\n── meeting-options corpus — ${checks.length} case(s) ──`);
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
