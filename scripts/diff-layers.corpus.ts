// scripts/diff-layers.corpus.ts
// Asserted, offline corpus for diff-layers.ts. NO network: the drafts are a
// fictional major built in code (invented quote text) and the catalog is a
// tiny hand-built one, same convention as validate-layers.corpus.ts. Exits
// nonzero on any mismatch.
//
// Run: npx tsx diff-layers.corpus.ts   (from the scripts/ folder)

import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { diffLayers, pairByScore, renderDiffMarkdown, type DiffReport } from "./diff-layers";
import { parseDraft, type CourseRule, type DistCatalog, type DistCourse, type Draft, type Row } from "./layer-authoring";

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
function assertTrue(name: string, cond: boolean, detail: string) {
  if (!cond) fail(name, detail);
}

// ── Fixture catalog ─────────────────────────────────────────────────────────
const course = (id: string, credits: number, tags: string[] = []): DistCourse => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number}`, credits, attrs: tags.map((value) => ({ value })) };
};
const catalogCourses: DistCourse[] = [
  course("ECON-1110", 4, ["SBA-X"]),
  course("ECON-3010", 4),
  course("ECON-3120", 4),
  course("ECON-4010", 4),
  course("MATH-1110", 4),
  course("MATH-2210", 4),
  course("HIST-1500", 3, ["HST-X"]),
  course("HIST-2500", 3, ["HST-X"]),
  course("ENGL-2000", 3, ["ALC-X"]),
  course("PHIL-1100", 3, ["ALC-X"]),
  course("BIOL-1100", 4),
  course("FREN-1210", 4),
  course("SPAN-1210", 4),
];
const CAT: DistCatalog = { courses: catalogCourses, byId: new Map(catalogCourses.map((c) => [c.id, c])) };

// ── Fixture drafts (a fictional major; quotes are invented) ─────────────────
const URL = "https://catalog.example.edu/demo-econ/";
const src = (anchor: string) => ({ url: URL, anchor });

function baseRows(): Row[] {
  return [
    { id: "core-micro", kind: "seat", label: "Intermediate micro", group: "Core", source: src("Core"), rule: { course: ["ECON-1110"] } },
    { id: "core-math", kind: "seat", label: "Calculus", group: "Core", source: src("Core"), rule: { course: ["MATH-1110", "MATH-2210"] } },
    {
      id: "upper",
      kind: "pool",
      label: "Upper-level electives",
      group: "Electives",
      source: src("Electives"),
      rule: { allOf: [{ subject: ["ECON"] }, { number: { min: 3000 } }] },
      requiredCourses: 3,
      requiredCredits: 9,
      limits: [
        { rule: { course: ["ECON-4010"] }, maxCourses: 1, label: "at most one seminar" },
        { rule: { number: { min: 4000 } }, minCourses: 1 },
      ],
    },
    {
      id: "breadth",
      kind: "distribution",
      label: "Breadth",
      group: "Breadth",
      source: src("Breadth"),
      categories: [
        { id: "hist", label: "History", rule: { tag: ["HST-X"] } },
        { id: "lit", label: "Literature", rule: { tag: ["ALC-X"] } },
        { id: "sci", label: "Science", rule: { subject: ["BIOL"] } },
      ],
      requiredCourses: 2,
      minDistinctCategories: 2,
      perCategory: { hist: { max: 1 } },
    },
    {
      id: "capstone",
      kind: "anyOf",
      label: "Capstone",
      group: "Capstone",
      source: src("Capstone"),
      rows: [
        { id: "honors", kind: "seat", label: "Honors thesis", group: "Capstone", source: src("Capstone"), rule: { course: ["ECON-4010"] } },
        {
          id: "project",
          kind: "pool",
          label: "Two project courses",
          group: "Capstone",
          source: src("Capstone"),
          rule: { allOf: [{ subject: ["ECON"] }, { number: { min: 3000 } }] },
          requiredCourses: 2,
          requiredCredits: 6,
        },
      ],
    },
    { id: "total", kind: "credits", label: "Major credits", group: "Total", source: src("Total"), rule: { subject: ["ECON"] }, requiredCredits: 30 },
    { id: "grades", kind: "confirm", label: "Grade of C or better in major courses", group: "Policy", source: src("Policy") },
  ];
}

function draft(author: "a" | "b", rows: Row[], over: Partial<Draft["layer"]> = {}): Draft {
  const quotes: Record<string, string[]> = {};
  for (const r of rows) quotes[r.id] = [`Invented catalog sentence for ${r.id} (${author}).`];
  return parseDraft({
    schemaVersion: 1,
    programId: "demo-econ-ba",
    author,
    model: author === "a" ? "model-one" : "model-two",
    framing: author === "a" ? "row-by-row" : "checklist-first",
    snapshot: { url: URL, textSha256: "0".repeat(64) },
    layer: { id: "demo-econ-ba", kind: "major", family: "cas", name: "Demo Economics (BA)", catalogYear: "2026-27", programId: "demo-econ-ba", rows, ...over },
    quotes,
  });
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function edit(fn: (rows: Row[]) => void): Row[] {
  const rows = baseRows();
  fn(rows);
  return rows;
}
const byId = <K extends Row["kind"]>(rows: Row[], id: string) => rows.find((r) => r.id === id) as Extract<Row, { kind: K }>;

const A = () => draft("a", baseRows());
const real = (d: DiffReport) => [...d.layerFields, ...d.pairs.flatMap((p) => p.differences)].filter((f) => f.severity === "real");
const realPaths = (d: DiffReport) => real(d).map((f) => f.path);
const ofSeverity = (d: DiffReport, s: string) => [...d.layerFields, ...d.pairs.flatMap((p) => p.differences)].filter((f) => f.severity === s);

/** Every list inside a rule reversed, course ids lower-cased with spaces. */
function scrambleRule(r: CourseRule): CourseRule {
  if ("allOf" in r) return { allOf: r.allOf.map(scrambleRule).reverse() };
  if ("anyOf" in r) return { anyOf: r.anyOf.map(scrambleRule).reverse() };
  if ("not" in r) return { not: scrambleRule(r.not) };
  if ("course" in r) return { course: r.course.map((c) => ` ${c.replace("-", " ").toLowerCase()}`).reverse() };
  if ("subject" in r) return { subject: r.subject.map((s) => s.toLowerCase()).reverse() };
  if ("tag" in r) return { tag: [...r.tag].reverse() };
  return clone(r);
}

/** New ids, labels, headings, anchors; rows, options, categories and limits
 *  reordered; rules scrambled. Means exactly the same thing. (A confirm row's
 *  label is its whole requirement, so it only changes case/punctuation.) */
function disguise(rows: Row[]): Row[] {
  const out = clone(rows).map((r): Row => {
    const base = { ...r, id: `b-${r.id}`, label: r.kind === "confirm" ? `${r.label.toUpperCase()}.` : `Reworded ${r.label}`, group: `${r.group} (B)`, source: { ...r.source, anchor: `${r.source.anchor} section` }, note: "author B note" };
    if (base.kind === "seat" || base.kind === "pool" || base.kind === "credits") base.rule = scrambleRule(base.rule);
    if (base.kind === "pool" && base.limits) base.limits = [...base.limits].reverse().map((l) => ({ ...l, rule: scrambleRule(l.rule), label: "relabelled" }));
    if (base.kind === "distribution") {
      base.categories = base.categories.map((c) => ({ id: `k-${c.id}`, label: `${c.label}!`, rule: scrambleRule(c.rule) })).reverse();
      base.perCategory = Object.fromEntries(Object.entries(base.perCategory ?? {}).map(([k, v]) => [`k-${k}`, v]));
    }
    if (base.kind === "anyOf")
      base.rows = base.rows
        .map((c) => {
          const cc = { ...c, id: `o-${c.id}`, label: `Option ${c.label}` };
          if ("rule" in cc && cc.rule) cc.rule = scrambleRule(cc.rule);
          return cc;
        })
        .reverse() as typeof base.rows;
    return base;
  });
  return out.reverse();
}

// ── Cases ───────────────────────────────────────────────────────────────────
check("identical drafts, renamed ids + shuffled rows and lists → 0 real", () => {
  for (const cat of [CAT, undefined]) {
    const d = diffLayers(A(), draft("b", disguise(baseRows()), { name: "Economics, demo" }), cat);
    assertEqual(`realCount (${cat ? "catalog" : "no catalog"})`, [d.realCount, realPaths(d)], [0, []]);
    assertEqual("all rows paired", [d.pairs.length, d.onlyA.length, d.onlyB.length], [7, 0, 0]);
    assertTrue("harmless differences are recorded", ofSeverity(d, "harmless").length > 10, String(ofSeverity(d, "harmless").length));
    assertEqual("pairs follow A's row order", d.pairs.map((p) => p.a.key), baseRows().map((r) => r.id));
    assertEqual("paired by content, not id", d.pairs.map((p) => p.b.key), baseRows().map((r) => `b-${r.id}`));
  }
});

check("changed requiredCredits → exactly 1 real", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => (byId<"pool">(rows, "upper").requiredCredits = 12))), CAT);
  assertEqual("realCount", d.realCount, 1);
  assertEqual("path", realPaths(d), ["requiredCredits"]);
  assertEqual("values", [real(d)[0].a, real(d)[0].b], [9, 12]);
});

check("course list reorder / whitespace / case → 0 real", () => {
  const d = diffLayers(
    A(),
    draft("b", edit((rows) => (byId<"seat">(rows, "core-math").rule = { course: [" math 2210", "Math-1110", "MATH 1110"] }))),
    CAT,
  );
  assertEqual("realCount", d.realCount, 0);
  assertTrue("noted as harmless", ofSeverity(d, "harmless").some((f) => f.path === "rule"), JSON.stringify(ofSeverity(d, "harmless")));
});

check('pattern "ECON 3xxx" vs allOf[subject ECON, number 3000–3999] → equivalent on the catalog, real without', () => {
  const rowsA = edit((rows) => (byId<"pool">(rows, "upper").rule = { pattern: "ECON 3xxx" }));
  const rowsB = edit((rows) => (byId<"pool">(rows, "upper").rule = { allOf: [{ subject: ["ECON"] }, { number: { min: 3000, max: 3999 } }] }));
  const withCat = diffLayers(draft("a", rowsA), draft("b", rowsB), CAT);
  assertEqual("catalog: realCount", withCat.realCount, 0);
  assertEqual("catalog: one equivalent on rule", ofSeverity(withCat, "equivalent").map((f) => f.path), ["rule"]);
  const noCat = diffLayers(draft("a", rowsA), draft("b", rowsB));
  assertEqual("no catalog: still paired", noCat.onlyA.length + noCat.onlyB.length, 0);
  assertEqual("no catalog: real on rule", realPaths(noCat), ["rule"]);
});

check("a rule that reaches different catalog courses is real, with the difference named", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => (byId<"pool">(rows, "upper").rule = { pattern: "ECON 3xxx" }))), CAT);
  assertEqual("real rule", realPaths(d), ["rule"]);
  assertTrue("note names ECON-4010", (real(d)[0].note ?? "").includes("ECON-4010"), real(d)[0].note ?? "");
});

check("extra row → onlyB", () => {
  const d = diffLayers(
    A(),
    draft("b", edit((rows) => rows.push({ id: "writing", kind: "seat", label: "Writing seminar", group: "Core", source: src("Core"), rule: { course: ["ENGL-2000"] } }))),
    CAT,
  );
  assertEqual("realCount", d.realCount, 1);
  assertEqual("onlyB", d.onlyB.map((s) => s.key), ["writing"]);
  assertEqual("quotes carried", d.onlyB[0].quotes, ["Invented catalog sentence for writing (b)."]);
});

check("two seats vs one 2-course pool → onlyA ×2, onlyB ×1, with counterpart hints", () => {
  const rule: CourseRule = { course: ["ECON-3010", "ECON-3120", "ECON-4010"] };
  const extraA: Row[] = [
    { id: "field-1", kind: "seat", label: "Field course", group: "Fields", source: src("Fields"), rule },
    { id: "field-2", kind: "seat", label: "Second field course", group: "Fields", source: src("Fields"), rule },
  ];
  const extraB: Row[] = [{ id: "fields", kind: "pool", label: "Two field courses", group: "Fields", source: src("Fields"), rule, requiredCourses: 2, requiredCredits: 0 }];
  for (const cat of [CAT, undefined]) {
    const d = diffLayers(draft("a", [...baseRows(), ...extraA]), draft("b", [...baseRows(), ...extraB]), cat);
    assertEqual("onlyA", d.onlyA.map((s) => s.key), ["field-1", "field-2"]);
    assertEqual("onlyB", d.onlyB.map((s) => s.key), ["fields"]);
    assertEqual("realCount", d.realCount, 3);
    assertTrue("A hint names B's pool", (d.onlyA[0].counterparts ?? []).some((h) => h.startsWith("fields (pool")), JSON.stringify(d.onlyA[0]));
    assertTrue("B hint names A's seats", (d.onlyB[0].counterparts ?? []).filter((h) => h.includes("(seat")).length === 2, JSON.stringify(d.onlyB[0]));
    const md = renderDiffMarkdown(d);
    assertTrue("markdown shows the hint", md.includes("Possible counterpart in B") && md.includes("ref: `onlyA field-1`"), md);
  }
});

check("unrelated rows of one kind stay unpaired", () => {
  const d = diffLayers(
    draft("a", [...baseRows(), { id: "hist", kind: "seat", label: "History course", group: "Core", source: src("Core"), rule: { course: ["HIST-1500"] } }]),
    draft("b", [...baseRows(), { id: "bio", kind: "seat", label: "History course", group: "Core", source: src("Core"), rule: { course: ["BIOL-1100"] } }]),
    CAT,
  );
  assertEqual("onlyA / onlyB", [d.onlyA.map((s) => s.key), d.onlyB.map((s) => s.key)], [["hist"], ["bio"]]);
});

check("anyOf: a child difference is real on the parent pair; an extra option too", () => {
  const d = diffLayers(
    A(),
    draft("b", edit((rows) => ((byId<"anyOf">(rows, "capstone").rows[1] as { requiredCourses: number }).requiredCourses = 3))),
    CAT,
  );
  assertEqual("child path", realPaths(d), ["rows[project~project].requiredCourses"]);
  const e = diffLayers(
    A(),
    draft("b", edit((rows) => byId<"anyOf">(rows, "capstone").rows.push({ id: "internship", kind: "seat", label: "Internship", group: "Capstone", source: src("Capstone"), rule: { course: ["ECON-3120"] } }))),
    CAT,
  );
  assertEqual("extra option", realPaths(e), ["rows[~internship]"]);
});

check("distribution: category id/label change → harmless; perCategory follows the pairing", () => {
  const d = diffLayers(
    A(),
    draft(
      "b",
      edit((rows) => {
        const b = byId<"distribution">(rows, "breadth");
        b.categories[0] = { id: "past", label: "The past", rule: { tag: ["HST-X"] } };
        b.perCategory = { past: { max: 1 } };
      }),
    ),
    CAT,
  );
  assertEqual("realCount", d.realCount, 0);
  assertTrue("relabel recorded as harmless", ofSeverity(d, "harmless").some((f) => f.path === "categories[hist~past].label"), JSON.stringify(ofSeverity(d, "harmless")));
});

check("distribution: perCategory max differs → real", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => (byId<"distribution">(rows, "breadth").perCategory = { hist: { max: 2 } }))), CAT);
  assertEqual("path", realPaths(d), ["perCategory[hist~hist]"]);
  const gone = diffLayers(A(), draft("b", edit((rows) => delete byId<"distribution">(rows, "breadth").perCategory)), CAT);
  assertEqual("dropped perCategory", realPaths(gone), ["perCategory[hist~hist]"]);
});

check("distribution: a missing category is real", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => byId<"distribution">(rows, "breadth").categories.pop())), CAT);
  assertEqual("path", realPaths(d), ["categories[sci~]"]);
});

check("distribution: eligibility moved from the row rule into the categories → equivalent", () => {
  const elig: CourseRule = { minCredits: 3 };
  const rowsA = edit((rows) => (byId<"distribution">(rows, "breadth").rule = elig));
  const rowsB = edit((rows) => {
    const b = byId<"distribution">(rows, "breadth");
    b.categories = b.categories.map((c) => ({ ...c, rule: { allOf: [c.rule, elig] } }));
  });
  for (const cat of [CAT, undefined]) {
    const d = diffLayers(draft("a", rowsA), draft("b", rowsB), cat);
    assertEqual("realCount", d.realCount, 0);
    assertEqual("row rule equivalent", ofSeverity(d, "equivalent").map((f) => f.path), ["rule"]);
  }
});

check("credits row: overlay absent ≡ true (≡ even false: always overlay)", () => {
  for (const v of [true, false]) {
    const d = diffLayers(A(), draft("b", edit((rows) => (byId<"credits">(rows, "total").overlay = v))), CAT);
    assertEqual(`overlay ${v}`, d.realCount, 0);
  }
  const seat = diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").overlay = true))), CAT);
  assertEqual("overlay on a seat is real", realPaths(seat), ["overlay"]);
});

check("seat credits absent ≡ 3; 4 is real", () => {
  assertEqual("3", diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").credits = 3))), CAT).realCount, 0);
  assertEqual("4", realPaths(diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").credits = 4))), CAT)), ["credits"]);
});

check("maxCategoriesPerCourse absent ≡ 1; 2 is real", () => {
  assertEqual("1", diffLayers(A(), draft("b", edit((rows) => (byId<"distribution">(rows, "breadth").maxCategoriesPerCourse = 1))), CAT).realCount, 0);
  assertEqual(
    "2",
    realPaths(diffLayers(A(), draft("b", edit((rows) => (byId<"distribution">(rows, "breadth").maxCategoriesPerCourse = 2))), CAT)),
    ["maxCategoriesPerCourse"],
  );
});

check("appliesTo: clause order and value order don't matter; a changed term does", () => {
  const rowsA = edit((rows) => (byId<"seat">(rows, "core-micro").appliesTo = [{ enteredFrom: "FA25" }, { transfer: ["external", "internal"] }]));
  const rowsB = edit((rows) => (byId<"seat">(rows, "core-micro").appliesTo = [{ transfer: ["internal", "external"] }, { enteredFrom: "FA25" }]));
  assertEqual("reordered", diffLayers(draft("a", rowsA), draft("b", rowsB), CAT).realCount, 0);
  const rowsC = edit((rows) => (byId<"seat">(rows, "core-micro").appliesTo = [{ transfer: ["internal", "external"] }, { enteredFrom: "FA26" }]));
  assertEqual("changed", realPaths(diffLayers(draft("a", rowsA), draft("b", rowsC), CAT)), ["appliesTo"]);
  const layerB = draft("b", baseRows(), { appliesTo: [{ enteredBefore: "FA25" }] });
  assertEqual("layer appliesTo", realPaths(diffLayers(A(), layerB, CAT)), ["appliesTo"]);
});

check("limits: order doesn't matter; a changed bound does", () => {
  const rowsB = edit((rows) => {
    const p = byId<"pool">(rows, "upper");
    p.limits = [...(p.limits ?? [])].reverse();
  });
  assertEqual("reordered", diffLayers(A(), draft("b", rowsB), CAT).realCount, 0);
  const rowsC = edit((rows) => (byId<"pool">(rows, "upper").limits![0].maxCourses = 2));
  assertEqual("changed bound", realPaths(diffLayers(A(), draft("b", rowsC), CAT)), ["limits"]);
  const rowsD = edit((rows) => (byId<"pool">(rows, "upper").limits![1].rule = { pattern: "ECON 4xxx" }));
  const eq = diffLayers(A(), draft("b", rowsD), CAT);
  assertEqual("limit rule equivalent on the catalog", [eq.realCount, ofSeverity(eq, "equivalent").map((f) => f.path)], [0, ["limits[1~1].rule"]]);
});

check("subjectGroups: a set of sets", () => {
  const rowsA = edit((rows) => {
    const p = byId<"pool">(rows, "upper");
    p.maxPerSubject = 2;
    p.subjectGroups = [["FREN", "ITAL"], ["SPAN", "PORT"]];
  });
  const rowsB = edit((rows) => {
    const p = byId<"pool">(rows, "upper");
    p.maxPerSubject = 2;
    p.subjectGroups = [["PORT", "SPAN"], ["ITAL", "FREN"]];
  });
  assertEqual("reordered", diffLayers(draft("a", rowsA), draft("b", rowsB), CAT).realCount, 0);
  const rowsC = edit((rows) => {
    const p = byId<"pool">(rows, "upper");
    p.maxPerSubject = 2;
    p.subjectGroups = [["FREN", "ITAL", "SPAN"], ["PORT", "SPAN"]];
  });
  assertEqual("regrouped", realPaths(diffLayers(draft("a", rowsA), draft("b", rowsC), CAT)), ["subjectGroups"]);
});

check("exclusive added → real; exclusive false ≡ absent", () => {
  assertEqual("added", realPaths(diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").exclusive = true))), CAT)), ["exclusive"]);
  assertEqual("false", diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").exclusive = false))), CAT).realCount, 0);
});

check("source.url differs → real; anchor wording → harmless", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => (byId<"seat">(rows, "core-micro").source = { url: "https://catalog.example.edu/other/", anchor: "Core courses" }))), CAT);
  assertEqual("real", realPaths(d), ["source.url"]);
  assertTrue("anchor harmless", ofSeverity(d, "harmless").some((f) => f.path === "source.anchor"), "");
});

check("layer fields: catalogYear is real, name is harmless", () => {
  const d = diffLayers(A(), draft("b", baseRows(), { catalogYear: "2025-26", name: "Other name" }), CAT);
  assertEqual("real", realPaths(d), ["catalogYear"]);
  assertTrue("name harmless", ofSeverity(d, "harmless").some((f) => f.path === "name"), "");
});

check("blind spots: cross-listing and AP/IB kind never count as equivalent on the catalog", () => {
  const xl = diffLayers(A(), draft("b", edit((rows) => (byId<"credits">(rows, "total").rule = { subject: ["ECON"], crossListed: true }))), CAT);
  assertEqual("crossListed true vs absent", realPaths(xl), ["rule"]);
  const xlFalse = diffLayers(A(), draft("b", edit((rows) => (byId<"credits">(rows, "total").rule = { subject: ["ECON"], crossListed: false }))), CAT);
  assertEqual("crossListed false ≡ absent", xlFalse.realCount, 0);
  const rowsA = edit((rows) => (byId<"credits">(rows, "total").rule = { allOf: [{ subject: ["ECON"] }, { not: { creditKind: ["ap"] } }] }));
  const rowsB = edit((rows) => (byId<"credits">(rows, "total").rule = { allOf: [{ subject: ["ECON"] }, { not: { creditKind: ["ib"] } }] }));
  assertEqual("not AP vs not IB", realPaths(diffLayers(draft("a", rowsA), draft("b", rowsB), CAT)), ["rule"]);
});

check("two rules that both match nothing are real, not equivalent", () => {
  const rowsA = edit((rows) => (byId<"seat">(rows, "core-micro").rule = { course: ["ECON-9990"] }));
  const rowsB = edit((rows) => (byId<"seat">(rows, "core-micro").rule = { course: ["ECON-9991"] }));
  const d = diffLayers(draft("a", rowsA), draft("b", rowsB), CAT);
  assertEqual("real (paired by tokens)", [realPaths(d), d.onlyA.length], [["rule"], 0]);
});

check("confirm rows: a reworded label is harmless, a different requirement is real", () => {
  const d = diffLayers(A(), draft("b", edit((rows) => (byId<"confirm">(rows, "grades").label = "grade of c or better in major courses."))), CAT);
  assertEqual("case/punctuation", d.realCount, 0);
  const e = diffLayers(A(), draft("b", edit((rows) => (byId<"confirm">(rows, "grades").label = "Grade of C or better in major courses and a 2.0 GPA overall"))), CAT);
  assertEqual("extra requirement in the label", realPaths(e), ["label"]);
});

check("the assignment is optimal, not greedy", () => {
  const s = [
    [0.9, 0.8],
    [0.85, 0],
  ];
  const p = pairByScore([0, 1], [0, 1], (i, j) => s[i][j]);
  assertEqual("pairs", p.pairs.map(([i, j]) => [i, j]), [
    [0, 1],
    [1, 0],
  ]);
  const q = pairByScore([0, 1, 2], [0], (i) => [0.2, 0.7, 0.5][i]);
  assertEqual("rectangular", [q.pairs.map(([i, j]) => [i, j]), q.onlyA, q.onlyB], [[[1, 0]], [0, 2], []]);
});

check("output is deterministic", () => {
  const b = draft("b", disguise(edit((rows) => (byId<"pool">(rows, "upper").requiredCredits = 12))));
  const x = JSON.stringify(diffLayers(A(), b, CAT));
  const y = JSON.stringify(diffLayers(A(), b, CAT));
  assertEqual("same json", x === y, true);
  assertEqual("one real on the disguised draft", JSON.parse(x).realCount, 1);
});

check("markdown: header, refs, both sides with quotes, equivalents, harmless count", () => {
  const rowsA = edit((rows) => (byId<"pool">(rows, "upper").rule = { pattern: "ECON 3xxx" }));
  const rowsB = edit((rows) => {
    byId<"pool">(rows, "upper").rule = { allOf: [{ subject: ["ECON"] }, { number: { min: 3000, max: 3999 } }] };
    byId<"credits">(rows, "total").requiredCredits = 32;
  });
  const md = renderDiffMarkdown(diffLayers(draft("a", rowsA), draft("b", rowsB), CAT));
  for (const s of [
    "# Diff — demo-econ-ba",
    "Author A: model-one (row-by-row)",
    "Author B: model-two (checklist-first)",
    "**Real differences: 1**",
    "ref: `pair total~total requiredCredits`",
    "> Invented catalog sentence for total (a).",
    "> Invented catalog sentence for total (b).",
    "- A value: `30`",
    "- B value: `32`",
    "## Equivalent on the catalog",
    "`upper` ~ `upper` `rule`",
    "## Harmless",
  ])
    assertTrue(`contains ${s}`, md.includes(s), md);
});

check("CLI: exit 0 when the drafts agree, 1 when they differ, 2 on bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-layers-"));
  const pa = join(dir, "a.json");
  const pb = join(dir, "b.json");
  const pc = join(dir, "c.json");
  writeFileSync(pa, JSON.stringify(A()));
  writeFileSync(pb, JSON.stringify(draft("b", disguise(baseRows()))));
  writeFileSync(pc, JSON.stringify(draft("b", edit((rows) => (byId<"pool">(rows, "upper").requiredCourses = 4)))));
  const run = (...args: string[]) => spawnSync(`npx tsx diff-layers.ts ${args.map((x) => `"${x}"`).join(" ")}`, { cwd: __dirname, shell: true, encoding: "utf-8" });
  const ok = run(pa, pb, "--no-catalog", "--out", join(dir, "same"));
  assertEqual("agree → 0", ok.status, 0);
  const diffJson = JSON.parse(readFileSync(join(dir, "same", "diff.json"), "utf-8"));
  assertEqual("diff.json written", diffJson.realCount, 0);
  assertEqual("differ → 1", run(pa, pc, "--no-catalog", "--out", join(dir, "differ")).status, 1);
  assertTrue("diff.md written", readFileSync(join(dir, "differ", "diff.md"), "utf-8").includes("requiredCourses"), "");
  assertEqual("one file → 2", run(pa, "--no-catalog").status, 2);
  writeFileSync(join(dir, "bad.json"), "{ not json");
  assertEqual("unreadable → 2", run(pa, join(dir, "bad.json"), "--no-catalog", "--out", dir).status, 2);
});

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n── diff-layers corpus — ${checks.length} case(s) ──`);
for (const c of checks) {
  const before = failures;
  try {
    c.fn();
  } catch (e) {
    fail(c.name, e instanceof Error ? e.stack ?? e.message : String(e));
  }
  if (failures === before) console.log(`  ✓ ${c.name}`);
}

console.log(`\n${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nCORPUS FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log("\nCORPUS PASSED.");
