// scripts/lead-lecturer.corpus.ts
// Asserted, offline corpus runner for the spec 017 index fields built by
// scripts/catalog-index.ts: leadLecturer() and the `roster` / `lead` fields on
// buildIndexRecords. NO network calls — every fixture is a hand-built
// course-doc-shaped object. Exits nonzero on any mismatch, same contract as
// scripts/unlocks.corpus.ts.
//
// Run: npx tsx lead-lecturer.corpus.ts   (from the scripts/ folder)

import { buildIndexRecords, leadLecturer } from "./catalog-index";

type Check = { name: string; fn: () => void };

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
  if (a !== e) fail(name, `expected ${e}, got ${a}`);
}

type Instr = { netid?: string; firstName?: string; lastName?: string };

function section(component: string, num: string, instructors: Instr[]) {
  return {
    code: `${component} ${num}`,
    component,
    openStatus: "O",
    gradingBasis: "GRD",
    components: [],
    instructors,
    meetings: [],
  };
}

const ada: Instr = { netid: "al101", firstName: "Ada", lastName: "Lovelace" };
const alan: Instr = { netid: "at202", firstName: "Alan", lastName: "Turing" };
const grace: Instr = { netid: "gh303", firstName: "Grace", lastName: "Hopper" };
const edsger: Instr = { netid: "ed404", firstName: "Edsger", lastName: "Dijkstra" };

function course(id: string, extra: Record<string, unknown>) {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `Course ${id}`, creditsMin: 3, creditsMax: 3, prereqExpr: null, ...extra };
}

// ── leadLecturer ─────────────────────────────────────────────────────────────

check("LEC wins even when a DIS section comes first", () => {
  const lead = leadLecturer({
    sections: [section("DIS", "201", [grace]), section("LEC", "001", [ada])],
  });
  assertEqual("lead from LEC, not the earlier DIS", lead, { netid: "al101", name: "Ada Lovelace", more: 0 });
});

check("+N counts the other distinct instructors on the primary component", () => {
  const lead = leadLecturer({
    sections: [
      section("LEC", "001", [ada, alan]),
      section("LEC", "002", [edsger]),
      section("DIS", "201", [grace]), // not the primary component: not counted
    ],
  });
  assertEqual("first LEC instructor leads, +2", lead, { netid: "al101", name: "Ada Lovelace", more: 2 });
});

check("an instructor repeated across sections counts once", () => {
  const lead = leadLecturer({
    sections: [
      section("LEC", "001", [ada, alan]),
      section("LEC", "002", [alan, ada]),
      section("LEC", "003", [ada]),
    ],
  });
  assertEqual("lead not double-counted, Alan counted once", lead, {
    netid: "al101",
    name: "Ada Lovelace",
    more: 1,
  });
});

check("staff-only primary component → null", () => {
  const lead = leadLecturer({
    sections: [section("LEC", "001", []), section("LEC", "002", [])],
  });
  assertEqual("no instructors → null", lead, null);
});

check("staff-only LEC with an instructor only on DIS → null (primary is LEC)", () => {
  const lead = leadLecturer({
    sections: [section("LEC", "001", []), section("DIS", "201", [grace])],
  });
  assertEqual("DIS instructor is not the lecturer", lead, null);
});

check("no sections → null", () => {
  assertEqual("empty array", leadLecturer({ sections: [] }), null);
  assertEqual("missing field", leadLecturer({}), null);
  assertEqual("non-array field", leadLecturer({ sections: "nope" }), null);
});

check("only SEM/IND sections → first section's component is primary", () => {
  const lead = leadLecturer({
    sections: [
      section("SEM", "101", [grace]),
      section("IND", "601", [ada, alan]),
      section("SEM", "102", [edsger]),
    ],
  });
  assertEqual("SEM primary; IND instructors ignored", lead, { netid: "gh303", name: "Grace Hopper", more: 1 });
});

check("instructor without a netid is skipped", () => {
  const lead = leadLecturer({
    sections: [
      section("LEC", "001", [{ netid: "", firstName: "No", lastName: "Netid" }, { firstName: "Also", lastName: "None" }, alan]),
    ],
  });
  assertEqual("first keyed instructor leads", lead, { netid: "at202", name: "Alan Turing", more: 0 });
});

check("name is trimmed when a part is missing", () => {
  const lead = leadLecturer({
    sections: [section("LEC", "001", [{ netid: "mono1", firstName: "", lastName: "Mononym" }])],
  });
  assertEqual("no leading space", lead, { netid: "mono1", name: "Mononym", more: 0 });
});

// ── buildIndexRecords wiring ────────────────────────────────────────────────

check("buildIndexRecords: roster passes through, lead computed, nulls when absent", () => {
  const records = buildIndexRecords([
    course("CS-2110", {
      roster: "SP27",
      offered: ["FA", "SP"],
      sections: [section("DIS", "201", [grace]), section("LEC", "001", [ada, alan])],
    }),
    course("HIST-1000", { roster: "FA26", sections: [section("LEC", "001", [])] }),
    course("OLD-1000", {}), // predates roster stamping, no sections
  ]);
  const byId = new Map(records.map((r) => [r.id, r]));
  assertEqual("SP27 roster", byId.get("CS-2110")?.roster, "SP27");
  assertEqual("SP27 lead", byId.get("CS-2110")?.lead, { netid: "al101", name: "Ada Lovelace", more: 1 });
  assertEqual("FA26 roster", byId.get("HIST-1000")?.roster, "FA26");
  assertEqual("staff-only lead null", byId.get("HIST-1000")?.lead, null);
  assertEqual("missing roster → null", byId.get("OLD-1000")?.roster, null);
  assertEqual("no sections → lead null", byId.get("OLD-1000")?.lead, null);
});

check("buildIndexRecords: existing fields unchanged by the new ones", () => {
  const [r] = buildIndexRecords([course("MATH-1910", { roster: "SP27", offered: ["FA", "SP"], attrs: [] })]);
  assertEqual("keys in order", Object.keys(r), [
    "id",
    "subject",
    "number",
    "title",
    "creditsMin",
    "creditsMax",
    "hasPrereqs",
    "offered",
    "attrs",
    "fws",
    "unlocks",
    "roster",
    "lead",
  ]);
  assertEqual("offered", r.offered, ["FA", "SP"]);
  assertEqual("hasPrereqs", r.hasPrereqs, false);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── lead-lecturer corpus — ${checks.length} case(s) ──`);
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
