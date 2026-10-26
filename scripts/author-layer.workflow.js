export const meta = {
  name: 'author-layer',
  description: 'Spec 019 D4 authoring chain for one CAS/CALS major: snapshot, two blind drafts, diff, resolve, verify, golden plan, review sheet',
  whenToUse: 'Phase 5: author one major layer. args: { programId, url, family, promote? }',
  phases: [
    { title: 'Snapshot', detail: 'save the catalog page (free fetch tiers only)' },
    { title: 'Draft', detail: 'two blind authors on different models and framings' },
    { title: 'Diff', detail: 'row-by-row comparison of the drafts' },
    { title: 'Resolve', detail: 'settle each disagreement against the cited sentence' },
    { title: 'Check', detail: 'independent verifier and golden plan, in parallel' },
    { title: 'Sheet', detail: 'review sheet, then promote when everything is clean' },
  ],
}

// Run with the Workflow tool: { scriptPath: "scripts/author-layer.workflow.js",
//   args: { programId: "cornell-economics-ba-2026",
//           url: "https://catalog.cornell.edu/programs/economics-ba/",
//           family: "cas", promote: false } }
// Every file this chain writes is under docs/provenance/<programId>/ (private),
// except the golden plan (scripts/seed-data/golden/layers/) and, on promote, the
// layer itself (scripts/seed-data/layers/<family>/). The orchestrator commits.

const A = args || {}
if (!A.programId || !A.url || !A.family) throw new Error('args need programId, url, family')
const ROOT = '<repo root>'
const PROV = `${ROOT}\\docs\\provenance\\${A.programId}`
const SCRIPTS = `${ROOT}\\scripts`

const COMMON = `
You are one step in a requirement-authoring chain for the Cornell Degree Planner (repo ${ROOT}, branch spec-019-cas-cals).
The program is ${A.programId} (family ${A.family}); its catalog page is ${A.url}.
Its private provenance folder is ${PROV}. Run tools from ${SCRIPTS} with \`npx tsx <tool>.ts\`.
Hard rules: never run git; never fetch the web (the page is already saved in ${PROV}\\snapshot — page.txt is the source of truth); never use Firecrawl; never touch Firestore.
Public files (anything under scripts/ or cornell-degree-planner/) must not contain sentences copied from the catalog page: labels and notes are paraphrases. Quotes go only in provenance files.
A false green (marking a requirement done that isn't) is worse than a false red: never encode a rule more generous than the page.`

const READ_FORMAT = `Read first: ${SCRIPTS}\\layer-authoring-guide.md (how to write a layer), ${SCRIPTS}\\layer-authoring.ts (the Draft envelope and file names), and the header of ${ROOT}\\cornell-degree-planner\\src\\lib\\planner\\distribution\\types.ts (the layer format).`

const BLIND = `You are one of two BLIND authors. Do NOT open, list or read draft-a.json, draft-b.json, check-*.json, diff.*, resolution.json, merged.json or verify.json in ${PROV}, nor any existing layer file for this program anywhere in the repo (scripts/seed-data/layers/**). Your work must be independent.`

const DRAFT_DONE = (who) => `Write your draft to ${PROV}\\draft-${who}.json (a Draft envelope: schemaVersion 1, programId, author "${who}", model, framing, snapshot {url, textSha256 from snapshot\\meta.json}, layer, quotes, notes). Then run \`npx tsx check-draft.ts ${PROV}\\draft-${who}.json --json ${PROV}\\check-${who}.json\` and fix every error until it exits 0 (at most 6 rounds; if errors remain, stop and report them). Return the schema fields.`

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
Your step: save the page. From ${SCRIPTS} run \`npx tsx snapshot-catalog-page.ts --program ${A.programId} --url ${A.url}\` (it fetches directly, falling back to the free Jina reader; it never uses a paid fetcher). If it fails, run it once more; if it fails again, report the error. Then read ${PROV}\\snapshot\\meta.json and skim page.txt to confirm it holds the program's requirements (not a challenge page or an empty shell). Return the schema fields.`,
  {
    label: 'snapshot',
    phase: 'Snapshot',
    effort: 'low',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        via: { type: 'string' },
        textSha256: { type: 'string' },
        textChars: { type: 'integer' },
        hasRequirements: { type: 'boolean', description: 'page.txt contains the requirement text' },
        error: { type: 'string' },
      },
      required: ['ok', 'hasRequirements'],
    },
  },
)
if (!snap || !snap.ok || !snap.hasRequirements) return { programId: A.programId, stoppedAt: 'snapshot', snap }
log(`snapshot via ${snap.via}, ${snap.textChars} chars`)

// ─── Two blind drafts ────────────────────────────────────────────────────────
phase('Draft')
const [draftA, draftB] = await parallel([
  () => agent(
    `${COMMON}
${BLIND}
${READ_FORMAT}
Your framing: ROW BY ROW. Read ${PROV}\\snapshot\\page.txt and work through the program's requirements in page order, writing one layer row per requirement as you go, each with its verbatim quote fragments. Then re-read the page top to bottom and check nothing was skipped (tables, footnotes, "or" lines, minimum grades, admission rules) and that no row is more generous than its sentence.
Set framing "row-by-row", model "opus".
${DRAFT_DONE('a')}`,
    { label: 'author A (opus, row by row)', phase: 'Draft', model: 'opus', schema: DRAFT_SCHEMA },
  ),
  () => agent(
    `${COMMON}
${BLIND}
${READ_FORMAT}
Your framing: CHECKLIST FIRST. Read ${PROV}\\snapshot\\page.txt and, before writing any JSON, write a plain-English checklist of everything a student must do to complete this major, one line per requirement, in your own words (put it in the draft's \`checklist\` field). Only then encode the checklist as layer rows, each with verbatim quote fragments. Finally compare the rows back against the checklist and the page.
Set framing "checklist-first", model "fable".
${DRAFT_DONE('b')}`,
    { label: 'author B (fable, checklist first)', phase: 'Draft', model: 'fable', schema: DRAFT_SCHEMA },
  ),
])
if (!draftA || !draftB || !draftA.ok || !draftB.ok) return { programId: A.programId, stoppedAt: 'draft', draftA, draftB }

// ─── Diff ────────────────────────────────────────────────────────────────────
phase('Diff')
const diff = await agent(
  `${COMMON}
Your step: compare the two drafts. From ${SCRIPTS} run \`npx tsx diff-layers.ts ${PROV}\\draft-a.json ${PROV}\\draft-b.json\` (exit 1 just means differences were found). Report realCount from ${PROV}\\diff.json and the number of equivalent and harmless differences. Do not interpret them.`,
  {
    label: 'diff',
    phase: 'Diff',
    effort: 'low',
    schema: {
      type: 'object',
      properties: { ran: { type: 'boolean' }, realCount: { type: 'integer' }, equivalent: { type: 'integer' }, harmless: { type: 'integer' }, error: { type: 'string' } },
      required: ['ran', 'realCount'],
    },
  },
)
if (!diff || !diff.ran) return { programId: A.programId, stoppedAt: 'diff', diff }
log(`${diff.realCount} real difference(s)`)

// ─── Resolve ─────────────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `${COMMON}
${READ_FORMAT}
Your step: RESOLVER. Two blind authors wrote ${PROV}\\draft-a.json and draft-b.json from ${PROV}\\snapshot\\page.txt; ${PROV}\\diff.md lists where they disagree (${diff.realCount} real differences).
For each real difference, find the sentence(s) on the page that decide it and pick A, B, both, or neither (writing the correct row yourself). Decide from the page's words, not from which author seems more careful. When the page genuinely does not settle it, choose the stricter reading (the one that can only cause a false red), and mark it needsMichael with a one-line question.
Write:
- ${PROV}\\merged.json: a Draft with author "merged", model "opus", framing "resolved", the same snapshot block, the merged layer, verbatim quotes for every row, and notes. Start from whichever draft needs fewer changes. Ids should be clear kebab-case.
- ${PROV}\\resolution.json: { programId, decisions: [{ ref, chosen, explanation, needsMichael }] } with one decision per real difference; copy each ref exactly from the \`ref:\` line diff.md prints for it (see Resolution in layer-authoring.ts). If there were 0 real differences, write merged from draft A and an empty decisions list.
Then run \`npx tsx check-draft.ts ${PROV}\\merged.json --json ${PROV}\\check-merged.json\` and fix until it exits 0. Return the schema fields.`,
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
if (!resolved || !resolved.ok) return { programId: A.programId, stoppedAt: 'resolve', resolved }

// ─── Verify + golden, independently, in parallel ─────────────────────────────
phase('Check')
const [verified, golden] = await parallel([
  () => agent(
    `${COMMON}
${READ_FORMAT}
Your step: VERIFIER. You check the finished layer against the page, independently. Read ONLY ${PROV}\\merged.json and ${PROV}\\snapshot\\page.txt (do NOT read the drafts, the diff or the resolution: your judgment must not be anchored on theirs).
For EVERY row unit of the merged layer (each top-level row, and each child of an anyOf, keyed "<parent>/<child>" — see rowUnits in layer-authoring.ts), decide whether the row means exactly what its quoted sentence(s) say: right courses, right counts and credits, right limits and exclusions, nothing more generous, nothing stricter without reason. Verdict "correct", "wrong" (say precisely what is wrong and what it should be) or "unsure" (say why).
Then read the page once more for requirements the layer MISSES (a required course, a limit, a minimum grade, an admission rule that gates the degree) that are not college-wide requirements. List each as a missing item with a verbatim quote.
Write ${PROV}\\verify.json: { programId, verdicts: [{ key, verdict, reason }], missing: [{ quote, reason }] }. Do not edit merged.json. Return the schema fields.`,
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
${READ_FORMAT}
Your step: GOLDEN PLAN. Write a known-good plan for this major: the smallest list of REAL catalog courses (a fictional student) that completes every checkable requirement on the PAGE. Choose courses from the page's own lists and rules (read ${PROV}\\snapshot\\page.txt); use ${PROV}\\merged.json only to know the layer id and the row structure. Every course must be needed: removing any one must leave a requirement short.
Write ${SCRIPTS}\\seed-data\\golden\\layers\\${A.programId}.json: { programId, description (one plain sentence, no catalog quotes), layerIds: ["${A.programId}"], ctx: { programId: "${A.programId}", entryTerm: "FA26", transfer: "none" }, plan: [course ids "SUBJ-NNNN"] } (see GoldenFixture in cornell-degree-planner/src/lib/planner/distribution/goldenPlan.ts). Then run \`npx tsx check-golden-layer.ts ${SCRIPTS}\\seed-data\\golden\\layers\\${A.programId}.json --layer ${PROV}\\merged.json --write --report ${PROV}\\golden-report.json\`.
If it fails, work out whether the PLAN is wrong (fix the plan and re-run, at most 4 rounds) or the LAYER disagrees with the page (do not edit the layer: report it as layerSuspect with the row key and the sentence). Return the schema fields.`,
    {
      label: 'golden plan (opus)',
      phase: 'Check',
      model: 'opus',
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          planSize: { type: 'integer' },
          layerSuspect: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok', 'planSize', 'layerSuspect'],
      },
    },
  ),
])

// ─── Review sheet, then promote if clean ─────────────────────────────────────
phase('Sheet')
const clean = !!(verified && golden && golden.ok && resolved.questions.length === 0 &&
  verified.wrong.length === 0 && verified.unsure.length === 0 && verified.missing.length === 0 &&
  golden.layerSuspect.length === 0)
const promote = clean && A.promote === true
const sheet = await agent(
  `${COMMON}
Your step: paperwork. From ${SCRIPTS} run \`npx tsx review-sheet.ts --program ${A.programId}\` and confirm ${PROV}\\review.md was written (exit 1 only means the sheet flags something for Michael; exit 2 is a real failure).${promote ? `
Then run \`npx tsx promote-layer.ts ${PROV}\\merged.json --family ${A.family}\` and report the file it wrote.` : ''}
Return the schema fields.`,
  {
    label: 'review sheet',
    phase: 'Sheet',
    effort: 'low',
    schema: {
      type: 'object',
      properties: { sheet: { type: 'boolean' }, promotedTo: { type: 'string' }, error: { type: 'string' } },
      required: ['sheet'],
    },
  },
)

return {
  programId: A.programId,
  snapshot: { via: snap.via, textSha256: snap.textSha256 },
  drafts: { a: draftA, b: draftB },
  realDifferences: diff.realCount,
  resolver: resolved,
  verifier: verified,
  golden,
  clean,
  promoted: promote ? sheet && sheet.promotedTo : null,
  sheet,
}
