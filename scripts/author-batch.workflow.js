export const meta = {
  name: 'author-batch',
  description: 'Layer authoring chain for a batch: majors/concentrations/colleges by two blind authors + resolver; minors (spec 047) by one author with a sentence ledger; verifier and golden plan per layer; one Opus reviewer over single-author batches',
  whenToUse: 'Author several layers whose snapshot and extract.json already exist. args: { runs: [...] }; a minor run is { layerId, kind: "minor", family, url } and takes the single-author path',
  phases: [
    { title: 'Draft', detail: 'two blind authors per layer (Sonnet), or one single author with a sentence ledger (minors)', model: 'sonnet' },
    { title: 'Resolve', detail: 'diff the drafts, settle every disagreement from the page', model: 'sonnet' },
    { title: 'Check', detail: 'independent verifier and golden plan per layer (minors: plus the overlap fixture), at most 2 repair rounds', model: 'sonnet' },
    { title: 'Review', detail: 'one cross-model reviewer over every single-author layer of the batch (read-only)', model: 'opus' },
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
//
// MINORS (spec 047 D12) take the single-author path (`single: true`, the default for
// kind "minor"; `single: false` falls back to the blind pair, whose resolver then also
// writes the sentence ledger):
//   { layerId: "cornell-data-science-minor-2026", kind: "minor", family: "other",
//     url: "https://catalog.cornell.edu/programs/data-science-minor/",
//     overlapMajor: "cornell-economics-ba-2026",   // optional: the promoted major for the overlap fixture
//     ctxMajor: "cornell-economics-ba-2026" }      // optional: the major in the minor's own golden ctx
//   1. one Sonnet author, checklist first, writes merged.src.json (framing "single-author")
//      with its sentence ledger; expand-draft + check-draft (<= 6 rounds); check-coverage.
//   2. Sonnet verifier and Sonnet golden plan in parallel; the golden plan also writes
//      golden-overlap.json (the minor with a real major where the limit binds; it says
//      what is held back) and overlap-report.json.
//   3. Stop rules: when the verifier and the golden plan disagree (one clean, one not),
//      the repairer reads the page before any edit and may refute a finding instead;
//      at most 2 repair rounds per layer, the second encoding the stricter rule plus a
//      confirm row where the page still doesn't settle it; then the run stops for the
//      orchestrator.
//   4. After every run: ONE Opus reviewer over all single-author layers of the batch
//      (read-only, the Phase 5 spot-check brief); its findings come back in the result
//      and fixes go through edit-ledger.ts. Fallback to the blind pair (`single: false`)
//      only for a minor whose review finds a false "met".
// Before a minor run: snapshot + extract (the orchestrator; stop if the extractor refuses)
// and an entry in scripts/seed-data/minor-index.json (notOpenTo comes from the page).

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
// A minor takes the single-author path unless `single: false` (the blind-pair fallback).
const RUNS = [...(Array.isArray(A.runs) ? A.runs : []), ...fromShorthand].map((r) => ({ ...r, single: r.single === undefined ? r.kind === 'minor' : r.single === true }))
if (!RUNS.length) throw new Error('args.runs is empty')
const IDS = new Set(RUNS.map((r) => r.layerId))
const ID_RE = /^[a-z0-9][a-z0-9-]{0,100}$/
for (const r of RUNS) {
  if (!r.layerId || !ID_RE.test(r.layerId)) throw new Error(`bad layerId ${r.layerId}`)
  // A concentration's chain reads its major's PROMOTED layer: promote the major first.
  if (r.kind === 'concentration' && IDS.has(r.programId)) throw new Error(`${r.layerId}: its major ${r.programId} is in the same batch; promote the major first`)
  // College versions: appliesTo is stated by the orchestrator (null = the default version).
  if (r.kind === 'college' && !('appliesTo' in r)) throw new Error(`college ${r.layerId} needs appliesTo (null for the default version)`)
  if (!['major', 'concentration', 'college', 'minor'].includes(r.kind)) throw new Error(`bad kind for ${r.layerId}`)
  if (!['cas', 'cals'].includes(r.family) && !(r.kind === 'minor' && r.family === 'other')) throw new Error(`bad family for ${r.layerId} (cas, cals; "other" for a minor only)`)
  if (r.single && r.kind === 'college') throw new Error(`${r.layerId}: college layers keep the blind pair`)
  // Majors the overlap fixture / golden ctx use must be PROMOTED, so never in this batch.
  for (const k of ['overlapMajor', 'ctxMajor']) {
    if (r[k] != null && (r.kind !== 'minor' || !ID_RE.test(r[k]))) throw new Error(`${r.layerId}: ${k} is a promoted major's layer id, on a minor run only`)
    if (r[k] != null && IDS.has(r[k])) throw new Error(`${r.layerId}: ${k} ${r[k]} is in the same batch; promote it first`)
  }
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
        : r.kind === 'minor'
          ? `the MINOR layer ${r.layerId} (family ${r.family}; spec 047)`
          : `the COLLEGE layer ${r.layerId} (family ${r.family}): ${r.scope}`
  return `You are one step in a requirement-authoring chain for the Cornell Degree Planner (a git repository).
Your working directory is the repository root (the folder that contains scripts/ and docs/); if it is not, cd there first.
You work on ${what}. Its catalog page is ${r.url}. Its private provenance folder is ${P}/.
Run tools from scripts/ exactly as given, e.g. \`cd scripts && npx tsx <tool>.ts ...\` (tool paths below are relative to scripts/).
Hard rules: never run git; never fetch the web (the page is saved); never touch Firestore; never edit anything in ${P}/snapshot/ or ${P}/extract.json.
Public files (anything under scripts/ or cornell-degree-planner/) must not contain sentences copied from the catalog page: layer names, labels, notes, group headings and the golden plan's description are paraphrases in your own words. Quotes go only in provenance files.
A false green (marking a requirement done that isn't) is worse than a false red: never encode a rule more generous than the page.`
}

const READ_FORMAT = `Read first: scripts/layer-authoring-guide.md (how to write a layer, including extracted lists and concentrations), scripts/layer-authoring.ts (the Draft envelope and file names), and the header of cornell-degree-planner/src/lib/planner/distribution/types.ts (the layer format). When a rule turns on a fact the board can't see ("if used toward", "with approval", "honors students", "taken for N credits"), the layer may ask the student: see the guide's "Questions (spec 020)" section (a closed list of types, no wording of your own, Cornell's sentence as the quote, usedAs only on an exclusive row; transfer kind and AP scores are never questions).`

function sourceOf(r) {
  const P = prov(r)
  const base = `Your sources: ${P}/snapshot/page.txt (the page as text; quote from it) and ${P}/extract.json (the same page, structured: every course table split into numbered lists "L1", "L2", … with each list's heading path and the header/comment lines just above it ("lead"), plus every sentence as a numbered block with its heading path). In a rule, name a whole extracted list as { "list": "L3" } (or { "list": ["L3", "L4"] }) instead of typing its courses; a list is exactly the course rows of one run of a table, "or" alternatives and "&" pairs included, so check its rows before using it whole (wrap it in allOf/not to exclude courses).`
  if (r.kind === 'concentration')
    return `${base}
Scope: ONLY the requirements under the page heading "${r.heading}" (and anything the page says applies to that concentration specifically). Set the layer's \`courseSharing\`: "separate" when the page says a course may not satisfy more than one requirement (or may not count toward both the major's requirements and the concentration's), "shared" when the page lets concentration courses also count toward major requirements or says nothing; quote the sentence that decides it, and say which in notes. The major's own requirements are already authored in scripts/seed-data/layers/${r.family}/${r.programId}.json: read it so you do not repeat its rows, but do not copy it. Header: id "${r.layerId}", kind "concentration", programId "${r.programId}", concentrationId "${r.concentrationId}", family "${r.family}".`
  if (r.kind === 'minor')
    return `${base}
Scope: the minor's own requirements, as the guide's "Minor layers" section describes (read it in full: consuming rows for every course-counting requirement, never a credits or overlay row as the main requirement; eligibility, grades and declaring the minor as confirm rows; AP/transfer and "taken at Cornell" through creditKind; "not open to X majors" is NOT a row, it goes to the ledger as "eligibility"; \`sharing\` with its "sharing" quote, the stricter limit the fields can express plus a confirm row when Cornell's rule is narrower, never a more generous one).
Two patterns the canary review caught (a confirm row ALONE is a false green; always encode the stricter rule too):
- A course restriction that depends on the student's major but names no majors ("students whose major requires an introductory programming course must take a more advanced course") → keep the confirm row AND add \`not: { allOf: [ { course: [...] }, { program: [...] } ] }\` to the consuming row, listing as program-id prefixes (no year) every major in scripts/seed-data/layers/{cas,cals}/*.json (not the "--" concentration files) and scripts/seed-data/programs.json / programs-2025/ whose own requirements name those courses (grep for the course ids). Listing too many majors only causes a false red, which is acceptable.
- A bar against part of another program ("cannot declare both this minor and the X concentration of the Y minor/major") → \`sharing.forbiddenWith\` on the WHOLE Y program's id prefix (the stricter bar the fields can say) plus a confirm row with the narrower real rule. Header: id = programId = "${r.layerId}", kind "minor", family "${r.family}"; no concentrations, no courseSharing, no college rows.`
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

// The sentence ledger and coverage step every minor's merged draft needs (spec 047 D12).
const MINOR_LEDGER = (r) => {
  const P = prov(r)
  const S = fromScripts(r)
  return `SENTENCE LEDGER (minors): merged.src.json must also carry \`ledger\`: one entry per in-scope block of ${P}/extract.json (prose "P…" and table-row "T…" blocks; a list "L…" or a heading "H…" may stand for all its rows / its whole section), each sent to a row id, "sharing", "eligibility" or "out-of-scope" (the last two with a reason; see the guide's "The single-author chain and its sentence ledger"). Rows of a list a row was expanded from are accounted for already. A sentence about overlap, grades, residency (at Cornell, transfer, AP) or eligibility is never "out-of-scope". check-draft reports misses as \`sentence-coverage\` errors. When check-draft exits 0, run \`cd scripts && npx tsx check-coverage.ts ${S}/merged.json\` (writes ${P}/coverage.json; must exit 0).`
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
5. Run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\` and \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\`; fix the source until it exits 0.${r.kind === 'minor' ? `\n${MINOR_LEDGER(r)}` : ''}
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
A row whose rule has an \`answered\` leaf reads a question (merged.json layer.questions; check-draft prints them under "questions"): judge the question inside that row's verdict, i.e. the right type and target row, its quote is the sentence that decides it, and the course limit sits beside the leaf so a stray yes cannot widen the row. A narrowed rule with an approvedFor / courseCondition question covering the approval is as CORRECT as one with a confirm row.
Then read the in-scope text once more for requirements the layer MISSES (a required course, a limit, a minimum grade, an admission rule that gates the degree)${r.kind === 'major' ? ' that are not college-wide requirements and not a concentration' : ''}.${r.kind === 'minor' ? `
MINOR extras (spec 047): (a) merged.json's \`ledger\` maps every block of extract.json; audit EVERY "out-of-scope" and "eligibility" entry: read the block and say in "missing" (with its verbatim quote) any that states a requirement of this minor; an "eligibility" entry must be about who may take the minor (it becomes notOpenTo), nothing else. (b) check-draft prints an "exclusions:" line: for each \`not\`, check the page really excludes those courses ("not accepted as fulfilling" lists name stand-ins, not exclusions), and give that row "wrong" when an exclusion removes courses the page lets count. (c) \`sharing\` (no row key: judge it inside the verdict of the row nearest its quote, or in "missing" when absent): it must match the quote under quotes.sharing, be the stricter limit the fields can express when Cornell's rule is narrower (with a confirm row stating the exact rule), and never be more generous. (d) every course-counting requirement must be a consuming row (seat, pool, distribution, anyOf), not a credits or overlay row.` : ''}
Run \`cd scripts && npx tsx check-draft.ts ${fromScripts(r)}/merged.json --json ${fromScripts(r)}/check-merged.json\` FIRST: copy the hash from its "layer sha256:" line, and use its "row units (N):" line as your checklist — verify.json must hold exactly one verdict for EACH of those N keys (no key skipped, no other keys).
"missing" is only for requirements of THIS layer the page states: do not list recommendations ("should", "encouraged", "strongly suggested"), rules that belong to the major layer, another concentration or the college, or anything a confirm row already covers.
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
    overlapRequired: { type: 'boolean', description: 'minors: the layer sets sharing.otherMajors, so an overlap fixture is needed' },
    overlapOk: { type: 'boolean', description: 'minors: check-overlap-fixture exited 0 (true when no fixture is required)' },
    overlapMajor: { type: 'string', description: 'minors: the major layer id the overlap fixture uses' },
    heldBack: { type: 'array', items: { type: 'string' }, description: 'minors: "<courseId> from <layerId>"' },
    overlapProblems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'planSize', 'probes', 'layerSuspect'],
}

// The minor's SECOND fixture (spec 047 D12): its overlap limit binding against a real major.
function overlapStep(r) {
  const P = prov(r)
  const S = fromScripts(r)
  return `SECOND FIXTURE (overlap, minors): write ${P}/golden-overlap.json, which proves the minor's overlap limit holds back a course. Shape (see the header of scripts/check-overlap-fixture.ts): { programId: "${r.layerId}", description (one plain sentence of your own, published), layerIds: ["<major layer id>", "${r.layerId}"], ctx: { programId: "<that major>", entryTerm: "FA26", transfer: "none" }, plan: [course ids], limit: { maxCourses?, maxCredits? }, shared: [course ids], heldBack: [{ courseId, from: "<layer id>", why (your own words) }] }.
- The major: ${r.overlapMajor ? `use ${r.overlapMajor} (scripts/seed-data/layers/**/${r.overlapMajor}.json)` : 'pick a promoted major layer from scripts/seed-data/layers/cas or cals whose rows count many of this minor\'s courses and which the minor is open to (not excluded by its "eligibility" ledger entries)'}. Read its layer file for its row rules; never edit it.
- First read merged.json's layer.sharing. If it has NO \`otherMajors\` (the page sets no limit toward majors), the minor has nothing to hold back: do NOT invent a limit, write no overlap fixture, and return overlapRequired false and overlapOk true. Otherwise return overlapRequired true and go on (when the limit has \`with\`, the major must match one of those prefixes).
- limit: the stricter of the major's sharing.minors (scoped by \`with\`) and the minor's sharing.otherMajors; "none" is { "maxCourses": 0 }.
- plan: real catalog courses that complete the minor on its own AND that both programs count, more than the limit allows (consuming or credits rows count; overlay rows never do). shared: exactly the courses both count. heldBack: the course(s) the limit holds back and from which program (the minor's id or the major's), enough that the pair is within the limit afterwards.
Run \`cd scripts && npx tsx check-overlap-fixture.ts ${S}/golden-overlap.json --layer ${S}/merged.json --write --report ${S}/overlap-report.json\` and fix the FIXTURE (at most 4 rounds) until it exits 0; when it shows the layer disagrees with the page (its \`sharing\` or a row), report layerSuspect instead of bending the fixture. Return overlapRequired, overlapOk, overlapMajor, heldBack ("<courseId> from <layerId>") and overlapProblems.`
}

function golden(r) {
  const P = prov(r)
  const S = fromScripts(r)
  const layerIds =
    r.kind === 'concentration' ? `["${r.programId}", "${r.layerId}"]` : `["${r.layerId}"]`
  const ctx =
    r.kind === 'college'
      ? JSON.stringify(r.ctx)
      : r.kind === 'minor'
        ? JSON.stringify({ programId: r.ctxMajor || '<a promoted major the minor is open to>', entryTerm: 'FA26', transfer: 'none' })
        : JSON.stringify({ programId: r.kind === 'concentration' ? r.programId : r.layerId, ...(r.kind === 'concentration' ? { concentrationId: r.concentrationId } : {}), entryTerm: 'FA26', transfer: 'none' })
  const extraLayer = r.kind === 'concentration' ? ` --layer seed-data/layers/${r.family}/${r.programId}.json` : ''
  const planScope =
    r.kind === 'concentration'
      ? `completes every checkable requirement of BOTH the major (scripts/seed-data/layers/${r.family}/${r.programId}.json; its known-good plan scripts/seed-data/golden/layers/${r.programId}.json is a fine starting point) and this concentration`
      : r.kind === 'college'
        ? `completes every checkable requirement of this college layer for the student context ${ctx}`
        : r.kind === 'minor'
          ? `completes every checkable requirement on the PAGE for this minor (the minor alone; ctx.programId names the student's major, ${r.ctxMajor ? r.ctxMajor : 'a promoted major from scripts/seed-data/layers/ that the minor is open to'}, never the minor)`
          : 'completes every checkable requirement on the PAGE for this major'
  return agent(
    `${common(r)}
${READ_FORMAT}
Your step: GOLDEN PLAN. Write a known-good plan: the smallest list of REAL catalog courses (a fictional student) that ${planScope}. Choose courses from the page's own lists and rules (${P}/snapshot/page.txt and ${P}/extract.json); use ${P}/merged.json only for the layer id and its row ids. Every course must be needed: removing any one must leave a requirement short.
Also write negative probes: for every exclusion, upper limit, level floor, "or" alternate and "does not count" the page states, add a real catalog course the page says must NOT count toward that row, as { courseId, rowId (the merged layer's row id), why (your own words) }. A probe means "this course must never count toward this row": never probe a course that may count there on its own but not together with another ("one of A or B, not both", a per-group cap) — the engine may count either one, so such a probe fails on a correct layer; check those rules by reading the row instead.
Write ${P}/golden-fixture.json: { programId: "${r.layerId}", description (one short plain sentence in your own words, not reusing the page's phrasing: it is published and checked for eight words in a row shared with the page), layerIds: ${layerIds}, ctx: ${ctx}, plan: [course ids "SUBJ-NNNN"], mustNotCount: [...] } (see GoldenFixture in cornell-degree-planner/src/lib/planner/distribution/goldenPlan.ts). Then run \`cd scripts && npx tsx check-golden-layer.ts ${S}/golden-fixture.json --layer ${S}/merged.json${extraLayer} --write --report ${S}/golden-report.json\`.
If it fails, compare with the PAGE before changing anything: a course reported "not load-bearing" means either the plan has slack or a layer row is looser than the page; a violated probe means the layer is looser than the page. Fix the PLAN only when the page shows the plan was wrong (at most 4 rounds). When the layer disagrees with the page, do not edit the layer and do not drop the course or probe that exposes it: report it as layerSuspect with the row id and the page's sentence.${r.kind === 'minor' ? `\n${overlapStep(r)}` : ''} Return the schema fields.`,
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

// ─── The single-author path (spec 047 D12: minors) ───────────────────────────

const SINGLE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'check-draft AND check-coverage both exited 0' },
    rows: { type: 'integer' },
    listRows: { type: 'integer' },
    ledgerEntries: { type: 'integer' },
    coverageOk: { type: 'boolean', description: 'check-coverage exited 0' },
    sharing: { type: 'string', description: 'the sharing field as written, or "absent"' },
    sharingQuoted: { type: 'boolean', description: 'quotes.sharing holds the sentence(s) behind it (or sharing is absent and the page sets no limit)' },
    eligibility: { type: 'array', items: { type: 'string' }, description: 'program-id prefixes the page bars from the minor (for its notOpenTo), each with the block id' },
    remainingErrors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' }, description: 'ambiguities and how you read them' },
  },
  required: ['ok', 'rows', 'coverageOk', 'sharing', 'sharingQuoted', 'eligibility', 'remainingErrors', 'notes'],
}

function singleAuthor(r) {
  const P = prov(r)
  const S = fromScripts(r)
  return agent(
    `${common(r)}
In ${P}/ read ONLY snapshot/ and extract.json (no previous/, no other layer's provenance, no git history); you may read scripts/seed-data/minor-index.json and any promoted layer under scripts/seed-data/layers/ for context, never to copy.
${READ_FORMAT}
${sourceOf(r)}
You are the ONLY author of this layer (framing "single-author"): no second author will catch what you miss, so a sentence ledger proves you read every sentence.
1. CHECKLIST FIRST. Before any JSON, write a plain-English checklist of everything a student must do for this minor, one line per requirement, in your own words (the draft's \`checklist\`), including grades, "taken at Cornell", AP/transfer limits, admission or sign-up rules, who may not take the minor, and how its courses may count toward a major or another minor.
2. Encode the checklist as rows (guide: "Minor layers"), \`sharing\` with its "sharing" quote when the page limits overlap, and every count quoted.
3. Write the ledger. ${MINOR_LEDGER(r)}
Then for every open rule (a subject or number range) apply each of the guide's common exclusions the page states anywhere, and re-read the page top to bottom against the ledger. Keep every course the page lists even when check-draft says the catalog lacks it.
Write ${P}/merged.src.json: a Draft SOURCE with schemaVersion 1, programId "${r.layerId}", author "merged", model "sonnet", framing "single-author", snapshot {url, textSha256 from snapshot/meta.json}, layer, quotes (a "sharing" key for the sharing field), checklist, ledger, notes, and derivedNumbers where a number is worked out rather than stated (a derived sharing bound goes under "sharing").
Run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\` (writes merged.json), \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\` and then \`cd scripts && npx tsx check-coverage.ts ${S}/merged.json\`. Fix every error IN THE SOURCE and re-run all three until both checks exit 0 (at most 6 rounds; if errors remain, stop and report them). Fix an error by correcting the draft, never by changing what the page says. Do not edit scripts/seed-data/minor-index.json: report who is barred in "eligibility". Return the schema fields.`,
    { label: `single author · ${r.layerId}`, phase: 'Draft', model: MODEL, schema: SINGLE_SCHEMA },
  )
}

const REPAIR_SINGLE_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean', description: 'merged.src.json was edited' },
    ok: { type: 'boolean', description: 'check-draft and check-coverage exit 0 on the layer as it is now' },
    fixed: { type: 'array', items: { type: 'string' }, description: 'row key: what changed, per the page' },
    refuted: { type: 'array', items: { type: 'string' }, description: 'finding: why the page shows the layer was right (cite the block id)' },
    questions: { type: 'array', items: { type: 'string' }, description: 'what the page still does not settle' },
  },
  required: ['changed', 'ok', 'fixed', 'refuted', 'questions'],
}

/** One repair round on a single-author layer. The verifier's and golden plan's
 *  findings come in as text; when they disagree the page decides first. */
function repairSingle(r, round, findings, disagree) {
  const P = prov(r)
  const S = fromScripts(r)
  return agent(
    `${common(r)}
${READ_FORMAT}
${sourceOf(r)}
Your step: REPAIR round ${round} of at most 2 for the single-author layer ${P}/merged.src.json (expanded to merged.json). These findings came from the checks:
---
${findings}
---
${disagree ? 'The verifier and the golden plan DISAGREE about this layer (one is clean, the other is not). Before ANY edit, read the page sentence(s) each finding concerns in page.txt (whole sentences and tables, not fragments) and decide from the page which check is right. A finding the page refutes goes in "refuted" with the block id, and you change nothing for it.' : 'Before any edit, read the whole page sentence(s) or table each finding concerns in page.txt; a finding the page refutes goes in "refuted" with the block id.'}
Fix ONLY what the page shows is wrong, in merged.src.json, encoding exactly what the page says; do not touch unrelated rows; never reuse a row id for a different requirement (give a new requirement a new id). Keep the ledger in step (a block that now goes to a new row says so).${round >= 2 ? ' This is the LAST round: where the page still does not settle a finding, encode the stricter reading (the one that can only cause a false red) plus a confirm row stating the exact rule, and list it in "questions".' : ''} Record each change in the draft's notes ("repair ${round}: ...").
Run \`cd scripts && npx tsx expand-draft.ts ${S}/merged.src.json\`, \`cd scripts && npx tsx check-draft.ts ${S}/merged.json --json ${S}/check-merged.json\` and \`cd scripts && npx tsx check-coverage.ts ${S}/merged.json\` until both checks exit 0. Never edit verify.json, the golden files or the overlap files: the checks run again on your layer. Return the schema fields.`,
    { label: `repair ${round} · ${r.layerId}`, phase: 'Check', model: MODEL, schema: REPAIR_SINGLE_SCHEMA },
  )
}

/** The verifier's and golden plan's findings as text, and whether each is clean. */
function checkFindings(r, v, g) {
  const lines = []
  if (!v) lines.push('verifier: did not finish')
  else {
    for (const w of v.wrong) lines.push(`verifier wrong: ${w}`)
    for (const u of v.unsure) lines.push(`verifier unsure: ${u}`)
    for (const m of v.missing) lines.push(`verifier missing: ${m}`)
    if (v.correct !== v.units) lines.push(`verifier: ${v.correct} of ${v.units} units correct`)
  }
  if (!g) lines.push('golden plan: did not finish')
  else {
    if (!g.ok) lines.push('golden plan: check-golden-layer failed')
    for (const s of g.layerSuspect) lines.push(`golden plan layerSuspect: ${s}`)
    if (r.kind === 'minor' && !g.overlapOk) lines.push(`overlap fixture failed: ${(g.overlapProblems || []).join('; ') || 'not written'}`)
  }
  const vClean = !!(v && v.correct === v.units && !v.wrong.length && !v.unsure.length && !v.missing.length)
  const gClean = !!(g && g.ok && !g.layerSuspect.length && (r.kind !== 'minor' || g.overlapOk === true))
  return { text: lines.join('\n'), vClean, gClean }
}

/** Verifier + golden in parallel, then at most 2 repair rounds (stop rules above). */
async function checkSingle(prev) {
  const r = prev.run
  // A repair run's own round counts toward the limit of 2.
  const rounds = [...(prev.repairs || [])]
  let v = null
  let g = null
  for (;;) {
    ;[v, g] = await parallel([() => verifier(r), () => golden(r)])
    const f = checkFindings(r, v, g)
    if (f.vClean && f.gClean) return { ...prev, verifier: v, golden: g, repairs: rounds, clean: true, questions: [] }
    if (rounds.length >= 2) return { ...prev, verifier: v, golden: g, repairs: rounds, clean: false, stoppedAt: 'repair-limit', questions: rounds.flatMap((x) => (x && x.questions) || []) }
    const disagree = f.vClean !== f.gClean
    if (disagree) log(`${r.layerId}: verifier and golden plan disagree; the repairer reads the page first`)
    const rep = await repairSingle(r, rounds.length + 1, f.text, disagree)
    rounds.push(rep)
    if (!rep || !rep.ok) return { ...prev, verifier: v, golden: g, repairs: rounds, clean: false, stoppedAt: 'repair', questions: [] }
    // Every finding refuted from the page and nothing changed: the orchestrator reads it.
    if (!rep.changed) return { ...prev, verifier: v, golden: g, repairs: rounds, clean: false, stoppedAt: 'refuted', questions: rep.questions || [] }
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          layerId: { type: 'string' },
          rowsChecked: { type: 'integer' },
          falseMet: { type: 'boolean', description: 'some finding lets the board show a requirement met that the page says is not' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'row unit key, "sharing", "ledger:<block>" or "minor-index"' },
                what: { type: 'string' },
                page: { type: 'string', description: 'the block id(s) of extract.json the finding rests on' },
                effect: { type: 'string', enum: ['false green', 'false red', 'wording'] },
                should: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['key', 'what', 'page', 'effect', 'should', 'confidence'],
            },
          },
          observations: { type: 'array', items: { type: 'string' }, description: 'low-severity notes, not findings' },
        },
        required: ['layerId', 'rowsChecked', 'falseMet', 'findings'],
      },
    },
  },
  required: ['layers'],
}

/** ONE cross-model reviewer over every single-author layer of the batch (the
 *  Phase 5 spot-check brief as the model). Read-only: findings come back here,
 *  fixes go through edit-ledger.ts. */
function reviewer(runs) {
  const list = runs
    .map((r) => `- ${r.layerId} (${r.kind}, family ${r.family}): docs/provenance/${r.layerId}/ — merged.json, snapshot/page.txt, extract.json, coverage.json, verify.json, golden-fixture.json, golden-overlap.json; its entry (if any) in scripts/seed-data/minor-index.json`)
    .join('\n')
  return agent(
    `You are an INDEPENDENT, READ-ONLY reviewer for the Cornell Degree Planner (a git repository; work from its root, the folder holding scripts/ and docs/). Never edit, create or move any file, never run git, never fetch the web, never touch Firestore. You may run read-only scripts from scripts/ (e.g. \`cd scripts && npx tsx check-draft.ts <merged.json> --no-catalog\` for the row-unit list and exclusion counts, or a throwaway comparison you write to the scratch area your session gives you, never in the repo).
Each layer below was written by ONE author (no blind pair), then passed check-draft, a sentence-coverage script, a verifier and golden plans. Errors that escaped such checks before were readings every check shared, so judge each layer against its saved page yourself, not against those reports.
${list}
Read scripts/layer-authoring-guide.md (especially "Minor layers", "Exam and transfer credit" and the warning about "not accepted as fulfilling") and the layer format header in cornell-degree-planner/src/lib/planner/distribution/types.ts.
For EVERY row unit (anyOf options too) of each layer: compare it with the page (snapshot/page.txt; extract.json lists for list-backed rows: check the row uses exactly the right table rows). Look hardest at: a row looser than its sentence (a false green), even when a confirm row covers it; exclusions (\`not\`) that remove courses the page lets count; counts, credit totals and caps; AP / transfer / "taken at Cornell" (creditKind); a course-counting requirement written as a credits or overlay row (it escapes the overlap limit); \`sharing\` against the "sharing" quote (the stricter limit the fields can express plus a confirm row when Cornell's rule is narrower; never more generous); the ledger's "out-of-scope" and "eligibility" entries (a requirement filed out of scope is a missing row); the minor-index.json entry's notOpenTo against the page's eligibility sentence; whether the overlap fixture's held-back course really is what the limit would hold back.
Do NOT report accepted policies: a stricter rule plus a confirm row, the guide's AP/IB/transfer handling, course ids the page names that the catalog lacks, wording you would merely phrase differently.
Per finding: the row key, what is wrong, the extract block id(s) it rests on (cite ids, do not copy the page's sentences), the effect (false green / false red / wording), what it should be, and your confidence. Set falseMet true for a layer when any finding is a false green. Put low-severity notes in observations. Return the schema fields.`,
    { label: `reviewer (${runs.length} layer${runs.length === 1 ? '' : 's'})`, phase: 'Review', model: 'opus', schema: REVIEW_SCHEMA },
  )
}

// ─── The chain, per run; runs flow independently (no barrier between them) ───
log(`${RUNS.length} run(s): ${RUNS.map((r) => `${r.layerId}${r.single ? ' (single author)' : ''}`).join(', ')}`)

const results = await pipeline(
  RUNS,
  async (r) => {
    if (r.repair || r.verifyOnly) return { run: r, drafts: null }
    if (r.single) {
      const s = await singleAuthor(r)
      const out = { run: r, drafts: { single: s } }
      if (!s || !s.ok || !s.coverageOk) return { ...out, stoppedAt: 'draft' }
      return out
    }
    const [a, b] = await parallel([() => authorA(r), () => authorB(r)])
    const out = { run: r, drafts: { a, b } }
    if (!a || !b || !a.ok || !b.ok) return { ...out, stoppedAt: 'draft' }
    return out
  },
  async (prev) => {
    if (prev.stoppedAt) return prev
    const noDecisions = { ok: true, realDifferences: 0, equivalent: 0, decisions: 0, questions: [], remainingErrors: [] }
    // verifyOnly: the layer is unchanged; only the verifier and golden plan run again.
    if (prev.run.verifyOnly) return { ...prev, resolver: noDecisions }
    if (prev.run.single) {
      // A repair run on a single-author layer: one repair round from the orchestrator's text.
      if (!prev.run.repair) return { ...prev, resolver: noDecisions }
      const rep = await repairSingle(prev.run, 1, prev.run.repair, false)
      if (!rep || !rep.ok) return { ...prev, resolver: noDecisions, repairs: [rep], stoppedAt: 'repair' }
      return { ...prev, resolver: noDecisions, repairs: [rep] }
    }
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
    if (prev.run.single) {
      const done = await checkSingle(prev)
      const v = done.verifier
      const g = done.golden
      log(`${prev.run.layerId}: ${done.clean ? 'clean' : `needs attention (${done.stoppedAt})`} (single author; verifier ${v ? `${v.correct}/${v.units}` : 'failed'}; golden ${g ? (g.ok ? 'ok' : 'failed') : 'failed'}${prev.run.kind === 'minor' ? `; overlap ${g && g.overlapRequired === false ? 'not needed (no limit toward majors)' : g && g.overlapOk ? `ok, held back ${(g.heldBack || []).join(', ')}` : 'failed'}` : ''}; ${(done.repairs || []).length} repair round(s))`)
      return done
    }
    const [v, g] = await parallel([() => verifier(prev.run), () => golden(prev.run)])
    const questions = [...(prev.resolver.questions || []), ...((prev.reconcile && prev.reconcile.questions) || [])]
    const minorOk = prev.run.kind !== 'minor' || !!(g && g.overlapOk)
    const clean = !!(v && g && g.ok && minorOk && questions.length === 0 && v.correct === v.units && !v.wrong.length && !v.unsure.length && !v.missing.length && !g.layerSuspect.length)
    log(`${prev.run.layerId}: ${clean ? 'clean' : 'needs attention'} (${prev.resolver.realDifferences} real differences; verifier ${v ? `${v.correct}/${v.units}` : 'failed'}; golden ${g ? (g.ok ? 'ok' : 'failed') : 'failed'})`)
    return { ...prev, verifier: v, golden: g, questions, clean }
  },
)

// ONE reviewer over every single-author layer that reached the checks (a barrier on
// purpose: the review compares the whole batch with one pair of eyes).
const reviewable = results.filter((x) => x && x.run.single && x.verifier).map((x) => x.run)
let review = null
if (reviewable.length) {
  phase('Review')
  review = await reviewer(reviewable)
  if (!review) log('reviewer did not finish: review the batch before promoting')
  else for (const l of review.layers) log(`review ${l.layerId}: ${l.findings.length} finding(s)${l.falseMet ? ' — FALSE MET: fall back to the blind pair for this layer' : ''}`)
} else log('no single-author layer reached the checks: no review')

const reviewOf = (id) => (review ? review.layers.find((l) => l.layerId === id) || null : null)

return results.map((x, i) =>
  x
    ? {
        layerId: x.run.layerId,
        single: !!x.run.single,
        stoppedAt: x.stoppedAt || null,
        clean: !!x.clean,
        drafts: x.drafts,
        resolver: x.resolver || null,
        reconcile: x.reconcile || null,
        repairs: x.repairs || [],
        verifier: x.verifier || null,
        golden: x.golden || null,
        questions: x.questions || [],
        review: x.run.single ? reviewOf(x.run.layerId) : null,
      }
    : { layerId: RUNS[i].layerId, stoppedAt: 'crashed', clean: false },
)
