export const meta = {
  name: 'author-layer',
  description: 'Spec 019 D4 authoring chain for one CAS/CALS major: snapshot, two blind drafts, diff, resolve, verify, golden plan, review sheet',
  whenToUse: 'Phase 5: author one major layer. args: { programId, url, family, promote? }',
  phases: [
    { title: 'Snapshot', detail: 'save the catalog page (free fetch tiers only)' },
    { title: 'Draft', detail: 'two blind authors on different models and framings' },
    { title: 'Diff', detail: 'row-by-row comparison of the drafts' },
    { title: 'Resolve', detail: 'settle each disagreement against the page' },
    { title: 'Check', detail: 'independent verifier and golden plan, in parallel' },
    { title: 'Sheet', detail: 'review sheet; promote only when the files on disk are clean' },
  ],
}

// Run with the Workflow tool: { scriptPath: "scripts/author-layer.workflow.js",
//   args: { programId: "cornell-economics-ba-2026",
//           url: "https://catalog.cornell.edu/programs/economics-ba/",
//           family: "cas", promote: false } }
// Everything this chain writes is under docs/provenance/<programId>/ (private).
// With promote: true and a clean run, promote-layer.ts copies the layer and the
// golden plan into scripts/seed-data/ (public); it re-checks every file on disk
// itself, so an agent's own report can never promote a layer. The orchestrator
// commits.

const A = args || {}
if (!A.programId || !A.url || !A.family) throw new Error('args need programId, url, family')
if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(A.programId)) throw new Error('bad programId')
const ID = A.programId
// Paths are relative (no spaces): PROV from the repo root, P from scripts/.
const PROV = `docs/provenance/${ID}`
const P = `../docs/provenance/${ID}`

const COMMON = `
You are one step in a requirement-authoring chain for the Cornell Degree Planner (git repo, branch spec-019-cas-cals).
Your working directory is the repository root (the folder that contains scripts/ and docs/); if it is not, cd there first.
The program is ${ID} (family ${A.family}); its catalog page is ${A.url}. Its private provenance folder is ${PROV}/.
Run tools from scripts/ exactly as given, e.g. \`cd scripts && npx tsx <tool>.ts ...\` (tool paths below are relative to scripts/).
Hard rules: never run git; never use Firecrawl or any paid fetcher; never touch Firestore.
Public files (anything under scripts/ or cornell-degree-planner/) must not contain sentences copied from the catalog page: layer labels, notes and the golden plan's description are paraphrases in your own words. Quotes go only in provenance files.
A false green (marking a requirement done that isn't) is worse than a false red: never encode a rule more generous than the page.`

const NO_FETCH = `Do not fetch the web: the page is saved in ${PROV}/snapshot/ and page.txt is the source of truth. Never edit anything in ${PROV}/snapshot/.`

const READ_FORMAT = `Read first: scripts/layer-authoring-guide.md (how to write a layer), scripts/layer-authoring.ts (the Draft envelope and file names), and the header of cornell-degree-planner/src/lib/planner/distribution/types.ts (the layer format). When a rule turns on a fact the board can't see ("if used toward", "with approval", "honors students", "taken for N credits"), the layer may ask the student: see the guide's "Questions (spec 020)" section (a closed list of types, no wording of your own, Cornell's sentence as the quote, usedAs only on an exclusive row; transfer kind and AP scores are never questions).`

const BLIND = `You are one of two BLIND authors. In ${PROV}/ you may read ONLY snapshot/ and your own draft and check file. Do not open, list or read anything else there (the other author's draft, any check, diff, resolution, merged, verify or golden file, review.md, or the previous/ folder of an earlier run), nor any layer file or golden fixture for this program elsewhere in the repo (scripts/seed-data/layers/**, scripts/seed-data/golden/**), nor git history. Your work must be independent.`

const DRAFT_DONE = (who) => `Write your draft to ${PROV}/draft-${who}.json (a Draft envelope: schemaVersion 1, programId, author "${who}", model, framing, snapshot {url, textSha256 from snapshot/meta.json}, layer, quotes, notes). Then run \`cd scripts && npx tsx check-draft.ts ${P}/draft-${who}.json --json ${P}/check-${who}.json\` and fix every error until it exits 0 (at most 6 rounds; if errors remain, stop and report them). Fix an error by correcting the draft, never by changing what the page says. Return the schema fields.`

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'check-draft exited 0' },
    rows: { type: 'integer' },
    remainingErrors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' }, description: 'ambiguities and how you read them' },
  },
  required: ['ok', 'rows', 'remainingErrors', 'notes'],
}

// ─── Snapshot ────────────────────────────────────────────────────────────────
phase('Snapshot')
const snap = await agent(
  `${COMMON}
Your step: save the page and clear the way for a fresh run.
1. Run \`cd scripts && npx tsx snapshot-catalog-page.ts --program ${ID} --url ${A.url}\`. It fetches the page directly, falling back to the free Jina reader. If a snapshot already exists and the page text has CHANGED, the tool refuses: do NOT pass --force; report changed: true and stop.
2. Read ${PROV}/snapshot/meta.json and skim page.txt to confirm it holds the program's requirements (not a challenge page or an empty shell).
3. If ${PROV}/ holds outputs of an earlier run besides snapshot/ (draft-*.json, check-*.json, diff.*, resolution.json, merged.json, verify.json, golden-*.json, review.md), move them all into ${PROV}/previous/, replacing any older previous/ folder. Never move or edit snapshot/.
Return the schema fields.`,
  {
    label: 'snapshot',
    phase: 'Snapshot',
    effort: 'low',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        changed: { type: 'boolean', description: 'the tool refused because the page text changed' },
        via: { type: 'string' },
        textSha256: { type: 'string' },
        textChars: { type: 'integer' },
        hasRequirements: { type: 'boolean', description: 'page.txt contains the requirement text' },
        movedPrevious: { type: 'boolean' },
        error: { type: 'string' },
      },
      required: ['ok', 'hasRequirements'],
    },
  },
)
if (!snap || !snap.ok || !snap.hasRequirements || snap.changed) return { programId: ID, stoppedAt: 'snapshot', snap }
log(`snapshot via ${snap.via}, ${snap.textChars} chars${snap.movedPrevious ? '; earlier run moved to previous/' : ''}`)

// ─── Two blind drafts ────────────────────────────────────────────────────────
phase('Draft')
const [draftA, draftB] = await parallel([
  () => agent(
    `${COMMON}
${NO_FETCH}
${BLIND}
${READ_FORMAT}
Your framing: ROW BY ROW. Read ${PROV}/snapshot/page.txt and work through the program's requirements in page order, writing one layer row per requirement as you go, each with its verbatim quote fragments (every course and number the row encodes must appear in its quotes). Then re-read the page top to bottom and check nothing was skipped (tables, footnotes, "or" lines, minimum grades, admission rules) and that no row is more generous than its sentence.
Set framing "row-by-row", model "opus".
${DRAFT_DONE('a')}`,
    { label: 'author A (opus, row by row)', phase: 'Draft', model: 'opus', schema: DRAFT_SCHEMA },
  ),
  () => agent(
    `${COMMON}
${NO_FETCH}
${BLIND}
${READ_FORMAT}
Your framing: CHECKLIST FIRST. Read ${PROV}/snapshot/page.txt and, before writing any JSON, write a plain-English checklist of everything a student must do to complete this major, one line per requirement, in your own words (put it in the draft's \`checklist\` field). Only then encode the checklist as layer rows, each with verbatim quote fragments (every course and number the row encodes must appear in its quotes). Finally compare the rows back against the checklist and the page.
Set framing "checklist-first", model "fable".
${DRAFT_DONE('b')}`,
    { label: 'author B (fable, checklist first)', phase: 'Draft', model: 'fable', schema: DRAFT_SCHEMA },
  ),
])
if (!draftA || !draftB || !draftA.ok || !draftB.ok) return { programId: ID, stoppedAt: 'draft', draftA, draftB }

// ─── Diff ────────────────────────────────────────────────────────────────────
phase('Diff')
const diff = await agent(
  `${COMMON}
${NO_FETCH}
Your step: compare the two drafts. Run \`cd scripts && npx tsx diff-layers.ts ${P}/draft-a.json ${P}/draft-b.json\` (exit 1 just means differences were found; exit 2 is a failure). Report realCount from ${PROV}/diff.json and the number of "equivalent on the catalog" and harmless differences (diff.md lists them). Do not interpret them.`,
  {
    label: 'diff',
    phase: 'Diff',
    effort: 'low',
    schema: {
      type: 'object',
      properties: { ran: { type: 'boolean' }, realCount: { type: 'integer' }, equivalent: { type: 'integer' }, harmless: { type: 'integer' }, error: { type: 'string' } },
      required: ['ran', 'realCount', 'equivalent'],
    },
  },
)
if (!diff || !diff.ran) return { programId: ID, stoppedAt: 'diff', diff }
log(`${diff.realCount} real difference(s), ${diff.equivalent} equivalent on the catalog`)

// ─── Resolve ─────────────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `${COMMON}
${NO_FETCH}
${READ_FORMAT}
Your step: RESOLVER. Two blind authors wrote ${PROV}/draft-a.json and draft-b.json from ${PROV}/snapshot/page.txt; ${PROV}/diff.md lists where they disagree: ${diff.realCount} real differences and ${diff.equivalent} "equivalent on the catalog" entries (rules that match the same catalog courses today but are written differently, e.g. a fixed list against an open rule; they can mean different things for courses added later).
For EACH real difference AND EACH equivalent entry, find the sentence(s) on the page that decide it — locate every quoted fragment in page.txt and read its whole sentence or table, never the fragment alone — and pick A, B, both, or neither (writing the correct row yourself). Decide from the page's words, not from which author seems more careful. When the page genuinely does not settle it, choose the stricter reading (the one that can only cause a false red), and mark it needsMichael with a one-line question.
Write:
- ${PROV}/merged.json: a Draft with author "merged", model "opus", framing "resolved", the same snapshot block, the merged layer, verbatim quotes for every row, and notes. Start from whichever draft needs fewer changes. Ids should be clear kebab-case.
- ${PROV}/resolution.json: { programId, decisions: [{ ref, chosen, explanation, needsMichael }] } with one decision per real difference and per equivalent entry; copy each ref exactly from the \`ref:\` line diff.md prints for it (see Resolution in scripts/layer-authoring.ts). If there was nothing to decide, write merged from draft A and an empty decisions list.
Then run \`cd scripts && npx tsx check-draft.ts ${P}/merged.json --json ${P}/check-merged.json\` and fix until it exits 0. Return the schema fields.`,
  {
    label: 'resolver (opus)',
    phase: 'Resolve',
    model: 'opus',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'check-draft on merged exited 0' },
        decisions: { type: 'integer' },
        questions: { type: 'array', items: { type: 'string' }, description: 'needsMichael questions' },
        remainingErrors: { type: 'array', items: { type: 'string' } },
      },
      required: ['ok', 'decisions', 'questions', 'remainingErrors'],
    },
  },
)
if (!resolved || !resolved.ok) return { programId: ID, stoppedAt: 'resolve', resolved }

// ─── Verify + golden, independently, in parallel ─────────────────────────────
phase('Check')
const [verified, golden] = await parallel([
  () => agent(
    `${COMMON}
${NO_FETCH}
${READ_FORMAT}
Your step: VERIFIER. You check the finished layer against the page, independently. Read ONLY ${PROV}/merged.json and ${PROV}/snapshot/page.txt (do NOT read the drafts, the diff, the resolution, previous/ or review.md: your judgment must not be anchored on theirs).
For EVERY row unit of the merged layer (each top-level row, and each child of an anyOf, keyed "<parent>/<child>" — see rowUnits in scripts/layer-authoring.ts): locate each of its quote fragments in page.txt and read the whole sentence, list item or table around it — a quote stitched from separate places, or cut short of a condition, is itself a fault. Then decide whether the row means exactly what the PAGE says there: right courses, right counts and credits, right limits and exclusions, nothing more generous, nothing stricter without reason. Verdict "correct", "wrong" (say precisely what is wrong and what it should be) or "unsure" (say why).
A row whose rule has an \`answered\` leaf reads a question (merged.json layer.questions; check-draft prints them under "questions"): judge the question inside that row's verdict, i.e. the right type and target row, its quote is the sentence that decides it, and the course limit sits beside the leaf so a stray yes cannot widen the row. A narrowed rule with an approvedFor / courseCondition question covering the approval is as CORRECT as one with a confirm row.
Then read the page once more for requirements the layer MISSES (a required course, a limit, a minimum grade, an admission rule that gates the degree) that are not college-wide requirements.
Write ${PROV}/verify.json exactly in this shape: { "programId": "${ID}", "verdicts": [{ "key", "verdict", "reason" }], "missing": [{ "quote": "<verbatim from page.txt>", "reason": "<what the layer lacks>" }] }, one verdict per unit. Do not edit merged.json. Return the schema fields (the summary arrays are short strings).`,
    {
      label: 'verifier (fable)',
      phase: 'Check',
      model: 'fable',
      schema: {
        type: 'object',
        properties: {
          units: { type: 'integer' },
          correct: { type: 'integer' },
          wrong: { type: 'array', items: { type: 'string' }, description: 'key: what is wrong' },
          unsure: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
        },
        required: ['units', 'correct', 'wrong', 'unsure', 'missing'],
      },
    },
  ),
  () => agent(
    `${COMMON}
${NO_FETCH}
${READ_FORMAT}
Your step: GOLDEN PLAN. Write a known-good plan for this major: the smallest list of REAL catalog courses (a fictional student) that completes every checkable requirement on the PAGE. Choose courses from the page's own lists and rules (read ${PROV}/snapshot/page.txt); use ${PROV}/merged.json only for the layer id and its row ids. Every course must be needed: removing any one must leave a requirement short.
Also write negative probes: for every exclusion, upper limit, level floor, "or" alternate and "does not count" the page states, add a real catalog course the page says must NOT count toward that row, as { courseId, rowId (the merged layer's row id), why (your own words) }.
Write ${PROV}/golden-fixture.json: { programId: "${ID}", description (one plain sentence in your own words), layerIds: ["${ID}"], ctx: { programId: "${ID}", entryTerm: "FA26", transfer: "none" }, plan: [course ids "SUBJ-NNNN"], mustNotCount: [...] } (see GoldenFixture in cornell-degree-planner/src/lib/planner/distribution/goldenPlan.ts). Then run \`cd scripts && npx tsx check-golden-layer.ts ${P}/golden-fixture.json --layer ${P}/merged.json --write --report ${P}/golden-report.json\`.
If it fails, compare with the PAGE before changing anything: a course reported "not load-bearing" means either the plan has slack or a layer row is looser than the page; a violated probe means the layer is looser than the page. Fix the PLAN only when the page shows the plan was wrong (at most 4 rounds). When the layer disagrees with the page, do not edit the layer and do not drop the course or probe that exposes it: report it as layerSuspect with the row id and the page's sentence. Return the schema fields.`,
    {
      label: 'golden plan (opus)',
      phase: 'Check',
      model: 'opus',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          planSize: { type: 'integer' },
          probes: { type: 'integer' },
          layerSuspect: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok', 'planSize', 'probes', 'layerSuspect'],
      },
    },
  ),
])

// ─── Review sheet, then promote (promote-layer re-checks the files itself) ───
phase('Sheet')
const sheet = await agent(
  `${COMMON}
${NO_FETCH}
Your step: paperwork. Run \`cd scripts && npx tsx review-sheet.ts --program ${ID}\` and report its exit code and the "N flag(s)" count it prints (exit 0 = nothing flagged, 1 = the sheet flags something for Michael, 2 = a broken input: report the error). Confirm ${PROV}/review.md was written by this run. Do nothing else.`,
  {
    label: 'review sheet',
    phase: 'Sheet',
    effort: 'low',
    schema: {
      type: 'object',
      properties: { exitCode: { type: 'integer' }, flags: { type: 'integer' }, error: { type: 'string' } },
      required: ['exitCode'],
    },
  },
)

const clean = !!(verified && golden && sheet && sheet.exitCode === 0 && golden.ok &&
  resolved.questions.length === 0 && verified.correct === verified.units &&
  verified.wrong.length === 0 && verified.unsure.length === 0 && verified.missing.length === 0 &&
  golden.layerSuspect.length === 0)

let promoted = null
if (clean && A.promote === true) {
  promoted = await agent(
    `${COMMON}
${NO_FETCH}
Your step: release. Run \`cd scripts && npx tsx promote-layer.ts --program ${ID} --family ${A.family}\`. It re-checks every chain file and refuses (exit 1) unless all is clean. Report its exit code and output lines. Do nothing else.`,
    {
      label: 'promote',
      phase: 'Sheet',
      effort: 'low',
      schema: {
        type: 'object',
        properties: { exitCode: { type: 'integer' }, output: { type: 'array', items: { type: 'string' } } },
        required: ['exitCode', 'output'],
      },
    },
  )
}

return {
  programId: ID,
  snapshot: { via: snap.via, textSha256: snap.textSha256, movedPrevious: !!snap.movedPrevious },
  drafts: { a: draftA, b: draftB },
  differences: { real: diff.realCount, equivalent: diff.equivalent },
  resolver: resolved,
  verifier: verified,
  golden,
  sheet,
  clean,
  promoted,
}
