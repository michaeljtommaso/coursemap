export const meta = {
  name: 'author-batch',
  description: 'Spec 019 Phase 5 authoring chain for a batch of CAS/CALS layers: two blind Sonnet authors, resolver, verifier and golden plan per layer',
  whenToUse: 'Phase 5: author several layers (majors, concentrations or college layers) whose snapshot and extract.json already exist. args: { runs: [...] }',
  phases: [
    { title: 'Draft', detail: 'two blind authors per layer (Sonnet, different framings)', model: 'sonnet' },
    { title: 'Resolve', detail: 'diff the drafts, settle every disagreement from the page', model: 'sonnet' },
    { title: 'Check', detail: 'independent verifier and golden plan per layer', model: 'sonnet' },
  ],
}

// Run with the Workflow tool: { scriptPath: "scripts/author-batch.workflow.js", args: { runs: [
//   { layerId: "cornell-economics-ba-2026", kind: "major", family: "cas",
//     url: "https://catalog.cornell.edu/programs/economics-ba/" },
//   { layerId: "cornell-animal-science-bs-2026--dairy-management", kind: "concentration", family: "cals",
//     programId: "cornell-animal-science-bs-2026", concentrationId: "dairy-management",
//     heading: "Dairy Management", url: "https://catalog.cornell.edu/programs/animal-science-bs/" },
//   { layerId: "cas-college", kind: "college", family: "cas", url: "...", appliesTo: null,
//     ctx: { programId: "test-cas-major", entryTerm: "FA26", transfer: "none" },
//     scope: "the Arts and Sciences graduation requirements", phase2: "cornell-degree-planner/src/lib/planner/distribution/fixtures/cas-college.json" },
// ] } }
//
// Before a run, the orchestrator saves the page and extracts it, per layer id,
// and moves any earlier run's outputs aside:
//   cd scripts && npx tsx snapshot-catalog-page.ts --program <layerId> --url <url>
//   cd scripts && npx tsx extract-catalog-page.ts --program <layerId> [--all for college layers]
//   cd scripts && npx tsx reset-run.ts --program <layerId>
// A concentration runs only after its major is promoted (validated below).
// After it, the orchestrator runs review-sheet.ts and promote-layer.ts itself; promotion
// is decided from the files on disk only. Everything this chain writes is under
// docs/provenance/<layerId>/ (private). Paths are repo-relative (no machine paths).

const A = args || {}
// Shorthand for concentrations: { concentrationsOf: [{ page: "<catalog slug>", family, headings: [...] }] }
// expands to one concentration run per heading (id = slug of the heading).
const concSlug = (h) =>
  h.toLowerCase().replace(/&/g, 'and').replace(/\(.*?\)/g, '').replace(/focused elective/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const fromShorthand = (Array.isArray(A.concentrationsOf) ? A.concentrationsOf : []).flatMap((g) =>
  g.headings.map((heading) => {
    const programId = `cornell-${g.page}-2026`
    const concentrationId = concSlug(heading)
    return { layerId: `${programId}--${concentrationId}`, kind: 'concentration', family: g.family, programId, concentrationId, heading, url: `https://catalog.cornell.edu/programs/${g.page}/` }
  }),
)
const RUNS = [...(Array.isArray(A.runs) ? A.runs : []), ...fromShorthand]
if (!RUNS.length) throw new Error('args.runs is empty')
const IDS = new Set(RUNS.map((r) => r.layerId))
for (const r of RUNS) {
  if (!r.layerId || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(r.layerId)) throw new Error(`bad layerId ${r.layerId}`)
  // A concentration's chain reads its major's PROMOTED layer: promote the major first.
  if (r.kind === 'concentration' && IDS.has(r.programId)) throw new Error(`${r.layerId}: its major ${r.programId} is in the same batch; promote the major first`)
  // College versions: appliesTo is stated by the orchestrator (null = the default version).
  if (r.kind === 'college' && !('appliesTo' in r)) throw new Error(`college ${r.layerId} needs appliesTo (null for the default version)`)
  if (!['major', 'concentration', 'college'].includes(r.kind)) throw new Error(`bad kind for ${r.layerId}`)
  if (!['cas', 'cals'].includes(r.family)) throw new Error(`bad family for ${r.layerId}`)
  if (!r.url) throw new Error(`no url for ${r.layerId}`)
  if (r.kind === 'concentration' && (!r.programId || !r.concentrationId || !r.heading)) throw new Error(`concentration ${r.layerId} needs programId, concentrationId, heading`)
  if (r.kind === 'college' && (!r.ctx || !r.scope)) throw new Error(`college ${r.layerId} needs ctx and scope`)
}
const MODEL = 'sonnet'

const prov = (r) => `docs/provenance/${r.layerId}`
const fromScripts = (r) => `../docs/provenance/${r.layerId}`

function common(r) {
  const P = prov(r)
  const what =
    r.kind === 'major'
      ? `the MAJOR layer ${r.layerId} (family ${r.family})`
      : r.kind === 'concentration'
        ? `the CONCENTRATION layer ${r.layerId}: only the "${r.heading}" concentration of the major ${r.programId} (family ${r.family})`
        : `the COLLEGE layer ${r.layerId} (family ${r.family}): ${r.scope}`
  return `You are one step in a requirement-authoring chain for the Cornell Degree Planner (git repo, branch spec-019-cas-cals).
Your working directory is the repository root (the folder that contains scripts/ and docs/); if it is not, cd there first.
You work on ${what}. Its catalog page is ${r.url}. Its private provenance folder is ${P}/.
Run tools from scripts/ exactly as given, e.g. \`cd scripts && npx tsx <tool>.ts ...\` (tool paths below are relative to scripts/).
Hard rules: never run git; never fetch the web (the page is saved); never touch Firestore; never edit anything in ${P}/snapshot/ or ${P}/extract.json.
Public files (anything under scripts/ or cornell-degree-planner/) must not contain sentences copied from the catalog page: layer names, labels, notes, group headings and the golden plan's description are paraphrases in your own words. Quotes go only in provenance files.
A false green (marking a requirement done that isn't) is worse than a false red: never encode a rule more generous than the page.`
}

const READ_FORMAT = `Read first: scripts/layer-authoring-guide.md (how to write a layer, including extracted lists and concentrations), scripts/layer-authoring.ts (the Draft envelope and file names), and the header of cornell-degree-planner/src/lib/planner/distribution/types.ts (the layer format).`

function sourceOf(r) {
  const P = prov(r)
  const base = `Your sources: ${P}/snapshot/page.txt (the page as text; quote from it) and ${P}/extract.json (the same page, structured: every course table split into numbered lists "L1", "L2", … with each list's heading path and the header/comment lines just above it ("lead"), plus every sentence as a numbered block with its heading path). In a rule, name a whole extracted list as { "list": "L3" } (or { "list": ["L3", "L4"] }) instead of typing its courses; a list is exactly the course rows of one run of a table, "or" alternatives and "&" pairs included, so check its rows before using it whole (wrap it in allOf/not to exclude courses).`
  if (r.kind === 'concentration')
    return `${base}
Scope: ONLY the requirements under the page heading "${r.heading}" (and anything the page says applies to that concentration specifically). Set the layer's \`courseSharing\`: "separate" when the page says a course may not satisfy more than one requirement (or may not count toward both the major's requirements and the concentration's), "shared" when the page lets concentration courses also count toward major requirements or says nothing; quote the sentence that decides it, and say which in notes. The major's own requirements are already authored in scripts/seed-data/layers/${r.family}/${r.programId}.json: read it so you do not repeat its rows, but do not copy it. Header: id "${r.layerId}", kind "concentration", programId "${r.programId}", concentrationId "${r.concentrationId}", family "${r.family}".`
  if (r.kind === 'college')
    return `${base}
Scope: ${r.scope}, exactly as the page states them (this page section applies to every student of the college, not one major; the saved page is one major's page, which repeats the university and college requirements in full: ignore that major's own requirements). Header: id "${r.layerId}", kind "college", family "${r.family}", ${r.appliesTo == null ? 'NO layer-level appliesTo (this is the default version of the college rules)' : `layer-level appliesTo exactly ${JSON.stringify(r.appliesTo)} (decided by Michael on 2026-10-25; do not re-decide it)`}${r.sourceNote ? `. ${r.sourceNote}` : ''}.`
  return `${base}
Scope: the major's own requirements (not the university or college requirements the page repeats below them). Header: id = programId = "${r.layerId}", kind "major", family "${r.family}". If the page has concentrations, do NOT author them (each is its own layer); if the page requires choosing concentrations, set the major's \`concentrations: { min, max }\` from the page and say so in notes.`
}

const BLIND = (r) =>
  `You are one of two BLIND authors. In ${prov(r)}/ you may read ONLY snapshot/, extract.json and your own files (draft-<you>.src.json, draft-<you>.json, check-<you>.json). Do not open, list or read anything else there (the other author's files, any diff, resolution, merged, verify or golden file, review.md, or previous/), nor any layer or golden file for ${r.layerId} elsewhere in the repo, nor git history. Your work must be independent.`

const DRAFT_DONE = (r, who) => {
  const P = prov(r)
  const S = fromScripts(r)
  return `Write your draft SOURCE to ${P}/draft-${who}.src.json (a Draft envelope: schemaVersion 1, programId "${r.layerId}", author "${who}", model "sonnet", framing, snapshot {url, textSha256 from snapshot/meta.json}, layer, quotes, notes${who === 'b' ? ', checklist' : ''}). Every top-level row needs at least one quote fragment copied word for word from page.txt that states what the row encodes, including every count (for a list-backed row, quote its lead line or the sentence that sets the count; the list itself cites its courses). A number the page implies but never states (e.g. "the remaining 3") goes in \`derivedNumbers\` ({ "<row id>": "how it follows from the page" }). A list with "or" or "&" rows cannot be counted course by course in a pool, credits or distribution row: name the courses yourself, or add "flatten": true to the { list } leaf only when every member truly counts on its own (see the guide).
Then run \`cd scripts && npx tsx expand-draft.ts ${S}/draft-${who}.src.json\` (writes draft-${who}.json) and \`cd scripts && npx tsx check-draft.ts ${S}/draft-${who}.json --json ${S}/check-${who}.json\`. Fix every error IN THE SOURCE and re-run both until check-draft exits 0 (at most 6 rounds; if errors remain, stop and report them). Fix an error by correcting the draft, never by changing what the page says. Return the schema fields.`
}

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'check-draft exited 0' },
    rows: { type: 'integer' },
    listRows: { type: 'integer', description: 'rows that use an extracted list' },
    remainingErrors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' }, description: 'ambiguities and how you read them' },
  },
  required: ['ok', 'rows', 'remainingErrors', 'notes'],
}

function authorA(r) {
  return agent(
    `${common(r)}
${BLIND(r)}
${READ_FORMAT}
${sourceOf(r)}
Your framing: ROW BY ROW. Work through the in-scope requirements in page order (extract.json's blocks are in page order), writing one layer row per requirement as you go. Keep every course the page lists in your rules, even if check-draft says the catalog lacks it (it accepts courses named on the page). Then re-read the in-scope text top to bottom and check nothing was skipped (tables, footnotes, "or" lines, "&" pairs, minimum grades, caps such as "no more than one", exclusions such as "does not count", admission rules) and that no row is more generous than its sentence. For every open rule (a subject or number range), go through the guide's list of common exclusions (writing seminars, honors thesis/independent study, language courses, credit floors, graduate courses, named courses that do not count) and apply each one the page states anywhere.
Set framing "row-by-row".
${DRAFT_DONE(r, 'a')}`,
    { label: `author A · ${r.layerId}`, phase: 'Draft', model: MODEL, schema: DRAFT_SCHEMA },
  )
}

function authorB(r) {
  return agent(
    `${common(r)}
${BLIND(r)}
${READ_FORMAT}
${sourceOf(r)}
Your framing: CHECKLIST FIRST. Before writing any JSON, write a plain-English checklist of everything a student must do to satisfy the in-scope requirements, one line per requirement, in your own words (the draft's \`checklist\` field). Only then encode the checklist as layer rows. Finally compare the rows back against the checklist and the page, looking especially for limits, exclusions and "or" choices; for every open rule, apply each of the guide's common exclusions the page states anywhere (writing seminars, honors thesis/independent study, language courses, credit floors, graduate courses, named courses that do not count). Keep every course the page lists in your rules, even if check-draft says the catalog lacks it (it accepts courses named on the page).
Set framing "checklist-first".
${DRAFT_DONE(r, 'b')}`,
    { label: `author B · ${r.layerId}`, phase: 'Draft', model: MODEL, schema: DRAFT_SCHEMA },
  )
}

const RESOLVE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'check-draft on merged exited 0' },
    realDifferences: { type: 'integer' },
    equivalent: { type: 'integer' },
    decisions: { type: 'integer' },
    questions: { type: 'array', items: { type: 'string' }, description: 'needsMichael questions' },
    remainingErrors: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'realDifferences', 'equivalent', 'decisions', 'questions', 'remainingErrors'],
}

function resolver(r) {
  const P = prov(r)
  const S = fromScripts(r)
  return agent(
    `${common(r)}
${READ_FORMAT}
${sourceOf(r)}
Your step: RESOLVER. Two blind authors wrote ${P}/draft-a.json and ${P}/draft-b.json (from draft-a.src.json / draft-b.src.json).
1. Run \`cd scripts && npx tsx diff-layers.ts ${S}/draft-a.json ${S}/draft-b.json\` (exit 1 just means differences were found; exit 2 is a failure). ${P}/diff.md lists the real differences and the "equivalent on the catalog" entries (rules that match the same catalog courses today but are written differently).
2. For EACH real difference AND EACH equivalent entry, find the sentence(s), table rows or extracted list that decide it — read the whole sentence or table around every quoted fragment, never the fragment alone — and pick A, B, both, or neither (writing the correct row yourself). Decide from the page's words, not from which author seems more careful. When the page genuinely does not settle it, choose the stricter reading (the one that can only cause a false red) and mark it needsMichael with a one-line question. Where the page leaves part of a requirement to an advisor or department, the guide's answer (a narrower rule plus a confirm row) settles it: no question needed.
Also restore any course the page lists that a rule left out (even if both drafts dropped it because the catalog lacks it): check-draft accepts courses named on the page.
3. Write ${P}/merged.src.json: a Draft SOURCE with author "merged", model "sonnet", framing "resolved", the same snapshot block, the merged layer (you may use { "list": "Ln" } leaves), verbatim quotes for every row, and notes. Start from whichever draft needs fewer changes. Keep each row's id exactly as it is in the draft the row comes from (A's or B's id; never rename a draft's row). A row neither draft has gets a new clear kebab-case id AND a decision { "ref": "added <id>", "chosen": "neither", ... } in step 4 — the review sheet traces every row to the diff or to such a decision.
4. Write ${P}/resolution.json: { programId: "${r.layerId}", decisions: [{ ref, chosen, explanation, needsMichael }] } where chosen is exactly one of the lowercase strings "a", "b", "both", "neither", with one decision per real difference and per equivalent entry; copy each ref exactly from the \`ref:\` line diff.md prints for it (see Resolution in scripts/layer-authoring.ts). If there was nothing to decide, write merged from draft A and an empty decisions list.
5. Run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\` and \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\`; fix the source until it exits 0.
Return the schema fields.`,
    { label: `resolver · ${r.layerId}`, phase: 'Resolve', model: MODEL, schema: RESOLVE_SCHEMA },
  )
}

const RECONCILE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'check-draft on merged exited 0 after reconciling' },
    differences: { type: 'integer' },
    keptPhase2: { type: 'integer', description: 'differences where the Phase 2 encoding was right and merged was changed' },
    keptMerged: { type: 'integer' },
    renamedRows: { type: 'integer' },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'differences', 'keptPhase2', 'keptMerged', 'renamedRows', 'questions'],
}

function reconcile(r) {
  const P = prov(r)
  const S = fromScripts(r)
  return agent(
    `${common(r)}
${READ_FORMAT}
${sourceOf(r)}
Your step: RECONCILE WITH PHASE 2. This college layer was hand-encoded in Phase 2 as ${r.phase2} (reviewed by two independent reviewers; 16 test plans in the same folder's plans/ check it by row id). The chain has now produced ${P}/merged.json independently. Treat the Phase 2 file as a third independent author.
1. Wrap the Phase 2 layer in a Draft envelope so the diff tool can read it: write ${P}/phase2-draft.json = { schemaVersion: 1, programId: "${r.layerId}", author: "b", model: "phase2", framing: "row-by-row", snapshot: <the same snapshot block as merged.json>, layer: <the Phase 2 file's contents, unchanged>, quotes: {} }. Then run \`cd scripts && npx tsx diff-layers.ts ${S}/merged.json ${S}/phase2-draft.json --out ${S}/phase2-diff\` (writes phase2-diff/diff.md; exit 1 just means differences). The A/B diff.json/diff.md in ${P}/ must stay untouched.
2. For each real or equivalent difference, decide from the PAGE which encoding is right (stricter when the page does not settle it, plus a question). Edit ${P}/merged.src.json accordingly.
3. Row ids: wherever a merged row means the same requirement as a Phase 2 row, give it the Phase 2 row's id (and anyOf child ids), so the Phase 2 test plans and saved waivers keep pointing at it.
4. Write ${P}/phase2-reconcile.json exactly in this shape: { "decisions": [{ "ref": <the ref: line from phase2-diff/diff.md>, "chosen": "merged"|"phase2"|"neither", "explanation": "...", "needsMichael": false|true }], "renamed": [{ "from": "<merged row id before you renamed it>", "to": "<the Phase 2 id it now has>" }] } (for anyOf children use "<parentId>/<childId>" on both sides). One decision per real or equivalent difference.
5. Re-run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\` and \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\` until it exits 0.
Return the schema fields.`,
    { label: `reconcile · ${r.layerId}`, phase: 'Resolve', model: MODEL, schema: RECONCILE_SCHEMA },
  )
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    units: { type: 'integer' },
    correct: { type: 'integer' },
    wrong: { type: 'array', items: { type: 'string' }, description: 'key: what is wrong' },
    unsure: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['units', 'correct', 'wrong', 'unsure', 'missing'],
}

function verifier(r) {
  const P = prov(r)
  return agent(
    `${common(r)}
${READ_FORMAT}
Your step: VERIFIER. You check the finished layer against the page, independently. Read ONLY ${P}/merged.json, ${P}/snapshot/page.txt and ${P}/extract.json${r.kind === 'concentration' ? ` (and the major's layer scripts/seed-data/layers/${r.family}/${r.programId}.json for context)` : ''}. Do NOT read the drafts, their sources, the diff, the resolution, previous/ or review.md: your judgment must not be anchored on theirs.
${sourceOf(r).split('\n').slice(1).join('\n')}
For EVERY row unit of the merged layer (each top-level row, and each child of an anyOf, keyed "<parent>/<child>" — see rowUnits in scripts/layer-authoring.ts): locate each of its quote fragments in page.txt and read the whole sentence, list item or table around it; for a row listed in merged.json's listRefs, open those lists in extract.json and check the row uses exactly the right table rows (no list from another section, no "or"/"&" row mishandled, exclusions applied). A quote stitched from separate places, or cut short of a condition, is itself a fault. Decide whether the row means exactly what the PAGE says there: right courses, right counts and credits, right limits and exclusions, nothing more generous, nothing stricter without reason. Verdict "correct", "wrong" (say precisely what is wrong and what it should be) or "unsure" (say why, only when the page itself is ambiguous).
Two rules from the guide decide common cases, so apply them instead of answering "unsure": (1) where the page leaves part of a requirement to a person (an advisor's or department's approval, a judgment about fit), a rule narrowed to what the page states outright PLUS a confirm row covering the rest is CORRECT; the same narrowing with no confirm row is WRONG. (2) Every course the page lists must be in the rule even when the catalog lacks it (check-draft keeps such courses): a rule that leaves out a course the page lists is WRONG.
Then read the in-scope text once more for requirements the layer MISSES (a required course, a limit, a minimum grade, an admission rule that gates the degree)${r.kind === 'major' ? ' that are not college-wide requirements and not a concentration' : ''}.
Finally run \`cd scripts && npx tsx check-draft.ts ${fromScripts(r)}/merged.json --json ${fromScripts(r)}/check-merged.json\` and copy the hash from its "layer sha256:" line.
Write ${P}/verify.json exactly in this shape: { "programId": "${r.layerId}", "layerSha256": "<that hash>", "verdicts": [{ "key", "verdict", "reason" }], "missing": [{ "quote": "<verbatim from page.txt>", "reason": "<what the layer lacks>" }] }, one verdict per unit. The hash ties your verdicts to the exact layer you read: if merged.json changes later, your verdicts no longer count. Do not edit merged.json. Return the schema fields (the summary arrays are short strings).`,
    { label: `verifier · ${r.layerId}`, phase: 'Check', model: MODEL, schema: VERIFY_SCHEMA },
  )
}

const GOLDEN_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    planSize: { type: 'integer' },
    probes: { type: 'integer' },
    layerSuspect: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'planSize', 'probes', 'layerSuspect'],
}

function golden(r) {
  const P = prov(r)
  const S = fromScripts(r)
  const layerIds =
    r.kind === 'concentration' ? `["${r.programId}", "${r.layerId}"]` : `["${r.layerId}"]`
  const ctx =
    r.kind === 'college'
      ? JSON.stringify(r.ctx)
      : JSON.stringify({ programId: r.kind === 'concentration' ? r.programId : r.layerId, ...(r.kind === 'concentration' ? { concentrationId: r.concentrationId } : {}), entryTerm: 'FA26', transfer: 'none' })
  const extraLayer = r.kind === 'concentration' ? ` --layer seed-data/layers/${r.family}/${r.programId}.json` : ''
  const planScope =
    r.kind === 'concentration'
      ? `completes every checkable requirement of BOTH the major (scripts/seed-data/layers/${r.family}/${r.programId}.json; its known-good plan scripts/seed-data/golden/layers/${r.programId}.json is a fine starting point) and this concentration`
      : r.kind === 'college'
        ? `completes every checkable requirement of this college layer for the student context ${ctx}`
        : 'completes every checkable requirement on the PAGE for this major'
  return agent(
    `${common(r)}
${READ_FORMAT}
Your step: GOLDEN PLAN. Write a known-good plan: the smallest list of REAL catalog courses (a fictional student) that ${planScope}. Choose courses from the page's own lists and rules (${P}/snapshot/page.txt and ${P}/extract.json); use ${P}/merged.json only for the layer id and its row ids. Every course must be needed: removing any one must leave a requirement short.
Also write negative probes: for every exclusion, upper limit, level floor, "or" alternate and "does not count" the page states, add a real catalog course the page says must NOT count toward that row, as { courseId, rowId (the merged layer's row id), why (your own words) }. A probe means "this course must never count toward this row": never probe a course that may count there on its own but not together with another ("one of A or B, not both", a per-group cap) — the engine may count either one, so such a probe fails on a correct layer; check those rules by reading the row instead.
Write ${P}/golden-fixture.json: { programId: "${r.layerId}", description (one short plain sentence in your own words, not reusing the page's phrasing: it is published and checked for eight words in a row shared with the page), layerIds: ${layerIds}, ctx: ${ctx}, plan: [course ids "SUBJ-NNNN"], mustNotCount: [...] } (see GoldenFixture in cornell-degree-planner/src/lib/planner/distribution/goldenPlan.ts). Then run \`cd scripts && npx tsx check-golden-layer.ts ${S}/golden-fixture.json --layer ${S}/merged.json${extraLayer} --write --report ${S}/golden-report.json\`.
If it fails, compare with the PAGE before changing anything: a course reported "not load-bearing" means either the plan has slack or a layer row is looser than the page; a violated probe means the layer is looser than the page. Fix the PLAN only when the page shows the plan was wrong (at most 4 rounds). When the layer disagrees with the page, do not edit the layer and do not drop the course or probe that exposes it: report it as layerSuspect with the row id and the page's sentence. Return the schema fields.`,
    { label: `golden · ${r.layerId}`, phase: 'Check', model: MODEL, schema: GOLDEN_SCHEMA },
  )
}

// A REPAIR run ({ ..., repair: "<what is wrong and what the page says>" }) skips the
// authors and the resolver: one agent edits the existing merged layer from the page
// (recording each change in resolution.json), then the verifier and the golden plan
// run again on the new layer. Used for problems the chain itself surfaced and for
// Michael's answers to open questions.
function repairer(r) {
  const P = prov(r)
  const S = fromScripts(r)
  return agent(
    `${common(r)}
${READ_FORMAT}
${sourceOf(r)}
Your step: REPAIR. The chain already produced ${P}/merged.src.json (expanded to merged.json) and ${P}/resolution.json. This problem must be fixed:
---
${r.repair}
---
1. Read the whole sentence(s) or table the problem concerns in page.txt, and fix ONLY that in ${P}/merged.src.json, encoding exactly what the page says (a narrower rule plus a confirm row where the board cannot see part of the condition). Do not change unrelated rows.
2. Record each change in ${P}/resolution.json: for a row you add, append { "ref": "added <rowId>", "chosen": "neither", "explanation": "<why, from the page>", "needsMichael": false }; for a row you change, update the explanation of its existing decision if it has one (keep the ref), or append an "added <rowId>" decision when it has none. Keep every other decision as it is. If the instruction is Michael's answer to an open question, set that decision's needsMichael to false and cite his answer in the explanation.
3. Run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\` and \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\` until it exits 0.
Return the schema fields (realDifferences and equivalent: 0; decisions: the number of decisions you added or changed; questions: anything the page still does not settle).`,
    { label: `repair · ${r.layerId}`, phase: 'Resolve', model: MODEL, schema: RESOLVE_SCHEMA },
  )
}

// ─── The chain, per run; runs flow independently (no barrier between them) ───
log(`${RUNS.length} run(s): ${RUNS.map((r) => r.layerId).join(', ')}`)

const results = await pipeline(
  RUNS,
  async (r) => {
    if (r.repair || r.verifyOnly) return { run: r, drafts: null }
    const [a, b] = await parallel([() => authorA(r), () => authorB(r)])
    const out = { run: r, drafts: { a, b } }
    if (!a || !b || !a.ok || !b.ok) return { ...out, stoppedAt: 'draft' }
    return out
  },
  async (prev) => {
    if (prev.stoppedAt) return prev
    // verifyOnly: the layer is unchanged; only the verifier and golden plan run again.
    if (prev.run.verifyOnly) return { ...prev, resolver: { ok: true, realDifferences: 0, equivalent: 0, decisions: 0, questions: [], remainingErrors: [] } }
    const res = prev.run.repair ? await repairer(prev.run) : await resolver(prev.run)
    const out = { ...prev, resolver: res }
    if (!res || !res.ok) return { ...out, stoppedAt: prev.run.repair ? 'repair' : 'resolve' }
    if (prev.run.kind === 'college' && prev.run.phase2 && !prev.run.repair) {
      const rec = await reconcile(prev.run)
      if (!rec || !rec.ok) return { ...out, reconcile: rec, stoppedAt: 'reconcile' }
      return { ...out, reconcile: rec }
    }
    return out
  },
  async (prev) => {
    if (prev.stoppedAt) return prev
    const [v, g] = await parallel([() => verifier(prev.run), () => golden(prev.run)])
    const questions = [...(prev.resolver.questions || []), ...((prev.reconcile && prev.reconcile.questions) || [])]
    const clean = !!(v && g && g.ok && questions.length === 0 && v.correct === v.units && !v.wrong.length && !v.unsure.length && !v.missing.length && !g.layerSuspect.length)
    log(`${prev.run.layerId}: ${clean ? 'clean' : 'needs attention'} (${prev.resolver.realDifferences} real differences; verifier ${v ? `${v.correct}/${v.units}` : 'failed'}; golden ${g ? (g.ok ? 'ok' : 'failed') : 'failed'})`)
    return { ...prev, verifier: v, golden: g, questions, clean }
  },
)

return results.map((x, i) =>
  x
    ? {
        layerId: x.run.layerId,
        stoppedAt: x.stoppedAt || null,
        clean: !!x.clean,
        drafts: x.drafts,
        resolver: x.resolver || null,
        reconcile: x.reconcile || null,
        verifier: x.verifier || null,
        golden: x.golden || null,
        questions: x.questions || [],
      }
    : { layerId: RUNS[i].layerId, stoppedAt: 'crashed', clean: false },
)
