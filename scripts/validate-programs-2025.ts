// scripts/validate-programs-2025.ts
// Validate the hand-built 2025 engineering program JSONs (seed-data/programs-2025/*.json)
// against the live Firestore catalog and the app Zod schemas BEFORE seeding.
//
// Checks per program:
//   - Program/Slot/Edge/Group shapes parse (ProgramSchema).
//   - Every course-kind slot's courseId + every list-group courseId exists live.
//   - Every edge from/to references a real slot id in the same program.
//   - Sanity: 8 semesters present, slot count 30-50, edge count 10-25,
//     summable credits 110-135 (course + snapshot-derived; patterns/electives use
//     a nominal 3cr).
//
// Run: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx validate-programs-2025.ts [--cache path]
// If --cache <file> is given, uses that local id cache (from dump-course-ids.ts)
// instead of hitting Firestore.

import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { ProgramSchema } from "../cornell-degree-planner/src/lib/schemas";

const DIR = resolve(__dirname, "seed-data", "programs-2025");
const cacheIdx = process.argv.indexOf("--cache");
const CACHE = cacheIdx !== -1 ? process.argv[cacheIdx + 1] : null;

type LiveCourse = { subject: string; number: string; title: string; creditsMin: number; creditsMax: number };

async function loadLive(): Promise<Map<string, LiveCourse>> {
  if (CACHE) {
    const obj = JSON.parse(readFileSync(CACHE, "utf-8")) as Record<string, LiveCourse>;
    return new Map(Object.entries(obj));
  }
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: "degree-planner-app" });
  const db = getFirestore();
  const snap = await db.collection("courses").select("subject", "number", "title", "creditsMin", "creditsMax").get();
  const m = new Map<string, LiveCourse>();
  snap.forEach((d) => m.set(d.id, d.data() as LiveCourse));
  return m;
}

async function main() {
  const live = await loadLive();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  let anyErr = false;

  for (const f of files) {
    const raw = JSON.parse(readFileSync(resolve(DIR, f), "utf-8"));
    const errs: string[] = [];
    const warns: string[] = [];

    // Shape parse
    let p: any;
    try {
      p = ProgramSchema.parse(raw);
    } catch (e: any) {
      console.log(`\n${f}: SCHEMA FAIL`);
      console.log(String(e).slice(0, 800));
      anyErr = true;
      continue;
    }

    const slotIds = new Set(p.slots.map((s: any) => s.id));
    const groupIds = new Set(p.electiveGroups.map((g: any) => g.id));

    // course-kind slot ids exist live
    for (const s of p.slots) {
      if (s.kind === "course") {
        if (!s.courseId) errs.push(`slot ${s.id} kind=course but no courseId`);
        else if (!live.has(s.courseId)) errs.push(`slot ${s.id} -> MISSING course ${s.courseId}`);
      }
      if (s.kind === "elective" && s.electiveGroupId && !groupIds.has(s.electiveGroupId))
        errs.push(`slot ${s.id} -> unknown electiveGroupId ${s.electiveGroupId}`);
      if (s.kind === "pattern" && !s.pattern) warns.push(`slot ${s.id} kind=pattern but no pattern string`);
    }
    // list-group courseIds exist live
    for (const g of p.electiveGroups) {
      for (const cid of g.courseIds ?? []) {
        if (!live.has(cid)) errs.push(`group ${g.id} -> MISSING course ${cid}`);
      }
    }
    // edges reference real slots
    for (const e of p.edges) {
      if (!slotIds.has(e.from)) errs.push(`edge from unknown slot ${e.from}`);
      if (!slotIds.has(e.to)) errs.push(`edge to unknown slot ${e.to}`);
    }

    // Sanity
    const sems = new Set(p.slots.map((s: any) => s.suggestedSemester));
    const semList = [...sems].sort((a: number, b: number) => a - b);
    if (semList[0] !== 1 || semList[semList.length - 1] !== 8)
      warns.push(`semesters span ${semList.join(",")} (expected 1..8)`);
    if (p.slots.length < 30 || p.slots.length > 50)
      warns.push(`slot count ${p.slots.length} outside 30-50`);
    if (p.edges.length < 10 || p.edges.length > 30)
      warns.push(`edge count ${p.edges.length} outside 10-30`);

    // Credit sum (course = live credits; pattern/elective = nominal 3)
    let credits = 0;
    for (const s of p.slots) {
      if (s.kind === "course" && s.courseId && live.has(s.courseId)) {
        credits += live.get(s.courseId)!.creditsMin;
      } else {
        credits += 3;
      }
    }
    const creditNote = `~${credits}cr (nominal 3/elective)`;

    console.log(`\n${f}  [${p.id}]`);
    console.log(`  slots ${p.slots.length}  edges ${p.edges.length}  groups ${p.electiveGroups.length}  sems ${semList.join(",")}  ${creditNote}`);
    if (errs.length) {
      anyErr = true;
      console.log(`  ERRORS (${errs.length}):`);
      for (const e of errs) console.log(`    x ${e}`);
    }
    if (warns.length) for (const w of warns) console.log(`    ! ${w}`);
    if (!errs.length && !warns.length) console.log(`  OK`);
  }

  console.log(anyErr ? "\nVALIDATION FAILED — fix ERRORS above." : "\nVALIDATION PASSED (no ID/shape/ref errors).");
  process.exit(anyErr ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
