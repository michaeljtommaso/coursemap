# Spec 002 — Supabase → Firebase Migration (Phase 2)

STATUS: PARTIAL (stage 1 — reads live; auth/plans pending)
Depends on: 001. Blocks: 005 (features need cloud plans).
Stage 1 done 2026-07-07 (branch phase-2-firebase): §10 steps 1–4 — Firebase
wiring + env + firebase.ts, Zod schemas + normalizers, SQL→JSON seed pipeline
(50/4/4/19/162/70), Admin SDK seeder (seeded live degree-planner-app, nam5), rules
v1 + 20-case emulator deny matrix (green) + rules deployed, reads ported to
services→providers→hooks (supabase deleted from the app). Playwright-verified
against live Firestore: 4 programs, CS 42-slot grid, catalog search normalization.
Stage 2 pending: §10 steps 5–9 — anonymous+Google auth, PlanProvider + cloud
plans + store shrink, localStorage import, App Check, roster-sync, backups,
hosting deploy, Analytics, and removing @supabase from scripts/.
Source: code audit (Supabase inventory) + house-standard vault conventions, 2026-07-07.

---

## 0. Context that shapes this spec

- The Supabase project is **gone** (NXDOMAIN). Source of truth for all catalog data is
  `supabase/migrations/002_seed.sql` (+ `001_schema.sql` for shapes, `003` for numeric
  credits). There is no live migration; this is a rebuild-on-Firebase.
- The app's entire Supabase surface is **5 query functions, all one-shot reads, zero
  auth, zero realtime, zero client writes**. Tiny port surface.
- The genuinely new work is the **user-data layer** (auth + cloud plans), which never
  existed. That's most of this spec.
- Conventions source: house-standard v2 (services→hooks→providers, normalizers, Zod
  `.passthrough()`, env separation, self-write exception). Deliberate deviation: keep
  Zustand for UI state (see spec 000 §2).

## 1. Firebase products & plan

- **Firestore** (data), **Auth** (anonymous + Google), **Hosting** (deploy).
- **No Cloud Functions in v1.** Rationale: every client write is a self-write to the
  user's own docs, enforceable in rules (house-standard exception rule: "match the write
  mechanism to the trust boundary"). Catalog writes happen only via Admin SDK scripts
  from your machine. Consequence: Spark (free) plan suffices; no Blaze required.
- Revisit Functions when share-link snapshots or server-side telemetry justify them.

## 2. Projects & env separation (house-standard conventions)

**Provisioned 2026-07-07 (Michael):** the Firebase project **`degree-planner-app`**
exists, with a web app registered and Analytics enabled. Decision (resolves spec 000
open question 2): **single project for now** — `degree-planner-app` serves as the
default/dev target; create a separate prod project only when testers are imminent
(revisit at Phase 5). Keep the house-standard named-scripts discipline from day one anyway so
adding prod later is a `.firebaserc` entry, not a refactor.

- `.firebaserc`: alias `default` → `degree-planner-app`; `production` added later.
- Vite modes bake config: `.env.development` / `.env.production` hold the `VITE_FB_*`
  web-config values (web config is public client config, safe to commit). Actual values:

  ```
  VITE_FB_API_KEY=<from-firebase-console>
  VITE_FB_AUTH_DOMAIN=degree-planner-app.firebaseapp.com
  VITE_FB_PROJECT_ID=degree-planner-app
  VITE_FB_STORAGE_BUCKET=degree-planner-app.firebasestorage.app
  VITE_FB_MESSAGING_SENDER_ID=<from-firebase-console>
  VITE_FB_APP_ID=<from-firebase-console>
  VITE_FB_MEASUREMENT_ID=<from-firebase-console>
  ```

  `src/lib/firebase.ts` reads these via `import.meta.env` — never hardcode the config
  object in source, so the later prod project is a pure env swap.
- **Analytics**: the console snippet's `getAnalytics(app)` is NOT adopted verbatim —
  initialize Analytics lazily via `isSupported().then(...)`, and only in production
  mode (`import.meta.env.PROD`), so dev sessions don't pollute GA4 data. See spec 005
  §7 for what it's used for (page-view-level tester telemetry only).
- **Never run raw `vite build`** — named scripts only:
  - `build:dev` = `vite build --mode development`
  - `build:prod` = `vite build --mode production`
  - `deploy:dev` = `npm run build:dev && firebase deploy -P default --only hosting`
  - `deploy:prod` (later) = `npm run build:prod && firebase deploy -P production --only hosting`
- Bake a fingerprint: expose `VITE_FB_PROJECT_ID` in a `<meta name="fb-project">` tag;
  post-deploy check greps the served HTML to prove which project a deploy hit.
- **Admin scripts (seed, roster sync, DB probing)** authenticate via the service-account
  key, stored outside the repo
  (provided 2026-07-07), referenced through the `GOOGLE_APPLICATION_CREDENTIALS` env
  var. Rules: the file stays outside the repo — never copied into the repo,
  never committed, contents never echoed into chat/docs/logs. Scripts fail fast with a
  clear message if the env var is unset. This key also enables Claude to probe/verify
  Firestore state directly during development (read counts, spot-check docs) via
  one-off Admin SDK scripts in `scripts/`.

## 3. Firestore data model

Design forces: Firestore has no joins and bills per doc read; the catalog is small,
read-heavy, write-never (except admin sync); program data is naturally
document-shaped (a flowchart is one coherent object).

```
courses/{courseId}                 # e.g. "CS-2110" — full course record
  subject, number, title, creditsMin, creditsMax (numbers, 1-decimal),
  description, offered: ["FA","SP"], prereqExpr: map|null,
  coreqExpr: map|null, rosterId, updatedAt

catalog/meta                       # singleton doc
  aliases: { "ENGRD-2110": "CS-2110", ... }        # 4 entries
  globalElectiveGroups: [ {id, name, description, qualifyingRule, minCredits,
                           advisorApproval, courseIds: [...] } ]
  seedVersion, syncedAt

catalogIndex/{chunk-000..N}        # client-side search index, ~300 records/chunk
  records: [ {id, subject, number, title, creditsMin, creditsMax,
              hasPrereqs: bool} ]

programs/{programId}               # e.g. "cornell-cs-bs-2026" — ONE read loads a program
  name, shortName, college, catalogYear, totalCredits, affiliationText
  electiveGroups: [ {id, name, qualifyingRule, minCredits, courseIds, ...} ]  # program-scoped
  slots: [ { id, kind: "course"|"pattern"|"elective",
             courseId|null, pattern|null, patternTitle|null,
             electiveGroupId|null, suggestedSemester, slotRow,
             # denormalized display snapshot (course-kind slots):
             courseTitle, creditsMin, creditsMax } ]
  edges: [ { from, to, type: "prereq"|"coreq"|"concurrent" } ]

users/{uid}                        # self-owned profile
  createdAt, displayName|null, authProvider,
  prefs: { theme }, activePlanId, importedLocalPlan: bool

users/{uid}/plans/{planId}         # the plan document (replaces localStorage)
  name, programId,
  slotSelections: { [slotId]: courseId },
  completedSlotIds: [...], waivedSlotIds: [...],
  courseSnapshots: { [courseId]: {id, subject, number, title,
                                  creditsMin, creditsMax} },  # display cache
  schemaVersion: 1, createdAt, updatedAt
```

Notes and rationale:
- **Program doc embeds slots + edges + its elective groups.** ~40 slots + ~18 edges per
  program with compact denormalized fields ≈ tens of KB — far under the 1 MB doc limit.
  Loading a program = **1 read** (vs 40+ if slots were a subcollection). This replaces
  the Postgres nested join `program_slots → courses, elective_groups`.
- **Denormalization discipline (field-shape-mismatch lesson):** slot snapshots carry only
  display fields (title, credits). Anything needing freshness (description, prereqExpr)
  is fetched from `courses/{id}` on demand. The roster-sync script (§8) regenerates
  program-doc snapshots after each course sync so they can't drift for more than one
  sync cycle.
- **Search without ilike:** `catalogIndex` chunks hold compact records; the client
  fetches all chunks once per session (~5 reads for ~1300 courses post-roster-sync,
  ~1 read for the 50-course seed), caches in a provider, and searches in memory
  (case-insensitive substring on id/code-normalized and title — port the existing
  `CS 1110`→`CS-1110` normalization from `searchCourses`). Debounce no longer needed at
  the network layer; keep a ~100ms input debounce for render cost only.
- **`prereqExpr`/`coreqExpr` port as-is** — JSONB trees are already nested maps/arrays;
  `evaluatePrereq.ts` doesn't change.
- **`elective_qualifications` join table** → `courseIds: []` array on each group object.
- **Plan doc = the old localStorage shape, cloudified.** `courseSnapshots` keeps the
  render-without-fetching property of the old `selectedCourses` cache but is now
  refreshable (see §6 staleness rule).
- IDs: keep the human-readable course/program/slot IDs from the seed (deterministic IDs
  are a house-standard habit and make rules/debugging saner). Plan IDs: `crypto.randomUUID()`.

## 4. Seed pipeline (SQL → Firestore)

One-time conversion, then a repeatable uploader:

1. `scripts/seed-data/` — convert `002_seed.sql` INSERT data to JSON files:
   `courses.json`, `aliases.json`, `programs.json` (with nested slots/edges/groups),
   `electiveQualifications.json`. This is a mechanical extraction (do it in-session with
   care around JSONB string escapes; validate counts: 50 courses / 4 aliases / 4
   programs / 19 groups / 162 slots / 70 edges).
   **Apply the known dedup bug**: the old DB had doubled `slot_edges` from a re-run seed;
   the JSON must contain the canonical ~70, deduped on (program, from, to, type).
2. `scripts/seed-firestore.ts` — Admin SDK batch writer: validates every record against
   the Zod schemas (§5) before writing, assembles program docs (slots + edges + groups +
   snapshot fields joined from courses.json), writes `courses/*`, `catalog/meta`,
   `catalogIndex/*`, `programs/*`. Idempotent (deterministic IDs, set-with-merge).
   Flags: `--project dev|prod`, `--dry-run` (prints counts + one sample doc per
   collection, writes nothing).
3. Keep `supabase/migrations/` in the repo as historical source data until the JSON is
   verified, then note in STATUS that Firestore is canonical.

Acceptance: `--dry-run` counts match the expected totals above; after real run, spot-check
in Firebase console: `programs/cornell-cs-bs-2026` has 40±2 slots, CS-2110 has a
prereqExpr tree.

## 5. Client architecture (house-standard layering)

```
src/lib/firebase.ts            # initializeApp + getFirestore/getAuth singletons
src/lib/schemas.ts             # Zod: CourseSchema, ProgramSchema, PlanSchema…
                               #   every entity schema ends .passthrough();
                               #   hard caps (.max) on strings/arrays
src/lib/normalize/             # normalizeCourse.ts, normalizeProgram.ts,
                               #   normalizePlan.ts — read-boundary shape bridges;
                               #   idempotent; preserve original field names
src/services/catalog.ts        # fetchCatalogIndex(), fetchCourse(id), fetchCatalogMeta()
src/services/programs.ts       # fetchPrograms() [list metadata], fetchProgram(id)
src/services/plans.ts          # subscribePlan(uid, planId, cb) → unsub
                               # createPlan(uid, data), updatePlan(uid, planId, patch)
                               # listPlans(uid)
src/services/auth.ts           # ensureAnonAuth(), linkWithGoogle(), onAuth(cb)
src/contexts/AuthProvider.tsx      # onAuthStateChanged → users/{uid} read;
                                   #   loading:true until profile resolved
src/contexts/CatalogProvider.tsx   # fetch-once-and-cache (index + meta);
                                   #   useRef Set guard, error+retry surface
src/contexts/ProgramProvider.tsx   # cache-by-id of program docs; fetch-once,
                                   #   stale-while-revalidate on repeat visits
src/contexts/PlanProvider.tsx      # onSnapshot on the active plan doc (§6)
src/hooks/…                        # thin useCatalog(), useProgram(id), usePlan(),
                                   #   useCourseSearch(query) [in-memory over index]
```

Service-layer contract (verbatim house-standard rules):
- Only `services/` touches Firestore. **No raw `getDoc`/`onSnapshot` outside it** — grep
  for escapees in review.
- Reads: `snap.data()` → normalizer → typed object. Subscribe functions return the
  unsubscribe directly. **Listeners degrade to empty + `console.warn`, never throw**
  (an uncaught onSnapshot error crashes the SDK under StrictMode) — but they must also
  set an `error` flag the UI can render (spec 003 error honesty).
- Writes: Zod-validate first, then write. **Never `serverTimestamp()` in anything
  JSON-serialized**; for direct SDK writes it's fine — use it for `updatedAt`.
- Providers mount once above the router/shell (session-owned); pages consume hooks.

## 6. Plan state: Zustand ↔ Firestore sync

The old model (all plan state in `usePlannerStore` → localStorage) becomes:

- `PlanProvider` owns the authoritative plan: `onSnapshot(users/{uid}/plans/{activePlanId})`.
- Mutations (`assignSlot`, `clearSlot`, `toggleCompleted`, `toggleWaived`) apply
  **optimistically to a local overlay** and write through `updatePlan()` **debounced
  600ms**, with **echo suppression** — keep `lastWrittenRef`, ignore the snapshot that
  round-trips your own write (this is exactly the standard layout-persistence
  recipe: self-write, debounce, echo-suppress, sanitize-on-load).
- Sanitize-on-load: drop `slotSelections` entries whose slotId doesn't exist in the
  current program doc; drop `courseSnapshots` no longer referenced. (Covers the audit's
  stale-persisted-program risk.)
- Snapshot staleness rule: when a plan loads, refresh any `courseSnapshots` entry whose
  course doc has `updatedAt > plan.updatedAt` — one batched `in` query, fire-and-forget.
- `usePlannerStore` shrinks to UI-only state (drag hover, panel open, selection) —
  no persistence of plan data. `useThemeStore` stays localStorage (also mirrored to
  `users/{uid}.prefs.theme` when authed — self-write).
- **Offline/unauth mode is gone on purpose**: anonymous auth is automatic and silent
  (§7), so there is always a uid. Firestore's local cache gives offline resilience
  for free (`enableIndexedDbPersistence` / default persistent cache in current SDK).

## 7. Auth & localStorage import

Providers decided 2026-07-07: **anonymous + Google only** (no email magic link —
Cornell email is Google Workspace, so Google sign-in covers cornell.edu accounts).

- On first load: `signInAnonymously()` automatically (no UI friction — testers land
  planning, not registering). TopBar shows a quiet "Save your plan" → `linkWithCredential`
  Google popup upgrade; on success the same uid keeps all plans.
- `users/{uid}` profile doc is created client-side on first auth (rules-constrained
  shape, §8) — acceptable deviation from the house standard's server-side-only profile creation
  because there are no roles/privileges to protect yet; revisit if roles appear.
- **localStorage import**: on first authed boot, if `cornell-planner-v2` exists and
  `users/{uid}.importedLocalPlan != true`: transform it into a plan doc (old
  `slotSelections`/`completedSlotIds`/`waivedSlotIds`/`selectedCourses` →
  `courseSnapshots`), create it, set `importedLocalPlan: true`, leave localStorage
  intact (rollback safety) but stop reading it.
- Multi-plan: `listPlans(uid)` powers a simple plan switcher (spec 004 TopBar); creating
  a plan requires choosing a program. `activePlanId` on the profile.

## 8. Security rules & hardening

> Informed by my standard Firebase security checklists.
> This app has no multi-tenancy, no roles, and no Functions — so the applicable
> lessons are: exact-shape allowlists, validate-twice, fail-closed default deny,
> author verification, App Check + quota caps as the abuse/cost ceiling, tested
> backups, and deploy discipline.

### 8a. Rules v1 (fail-closed)

```
// firestore.rules — VALIDATE TWICE: every cap below mirrors src/lib/schemas.ts.
// Keep the two numerically identical; a comment on each side points at the other.
match /courses/{id}       { allow read: if true; }        // write: Admin SDK only
match /catalog/{id}       { allow read: if true; }
match /catalogIndex/{id}  { allow read: if true; }
match /programs/{id}      { allow read: if true; }
match /users/{uid} {
  allow read, delete: if request.auth != null && request.auth.uid == uid;
  allow create, update: if request.auth != null && request.auth.uid == uid
    && request.resource.data.keys().hasOnly(
         ['createdAt','displayName','authProvider','prefs',
          'activePlanId','importedLocalPlan'])
    && (!('displayName' in request.resource.data)
        || request.resource.data.displayName == null
        || (request.resource.data.displayName is string
            && request.resource.data.displayName.size() <= 80));
  match /plans/{planId} {
    allow read, delete: if request.auth != null && request.auth.uid == uid;
    allow create, update: if request.auth != null && request.auth.uid == uid
      && request.resource.data.keys().hasOnly(
           ['name','programId','slotSelections','completedSlotIds',
            'waivedSlotIds','courseSnapshots','schemaVersion',
            'createdAt','updatedAt'])
      && request.resource.data.name is string
      && request.resource.data.name.size() <= 80
      && request.resource.data.slotSelections.size() <= 120
      && request.resource.data.courseSnapshots.size() <= 150
      && request.resource.data.completedSlotIds.size() <= 150
      && request.resource.data.waivedSlotIds.size() <= 150;
  }
}
// shares (spec 005): author-verified create, immutable after (no update rule at all)
match /shares/{shareId} {
  allow read: if true;
  allow create: if request.auth != null
    && request.resource.data.createdBy == request.auth.uid   // can't forge author
    && request.resource.data.keys().hasOnly([...exact share shape...]);
  // no update/delete — immutable snapshot (house-standard audit-trail pattern)
}
match /{document=**} { allow read, write: if false; }        // default deny, explicit
```

Notes:
- **Size caps in rules are the server-side validation** (no Functions = rules ARE the
  boundary; client Zod is UX only). Caps sit above real usage (a plan is ~40–60 slots).
- **No privileged fields exist** on `users/{uid}` today. The moment any
  privilege-granting field appears (role, admin flag, beta flag), it moves behind the
  house-standard self-escalation pattern: diff-denylist on self-writes + server-side-only
  profile creation. Record this as a tripwire comment in the rules file.
- **Admin-SDK-only data** (catalog, programs, indexes): no client write path exists at
  all — the strongest rule is the absent one.

### 8b. Rules emulator tests (non-negotiable, before first deploy)

`@firebase/rules-unit-testing` + Firestore emulator; `npm run test:rules`. Deny-matrix
coverage: cross-uid plan read/write (must fail), profile with extra keys (fail),
oversized name/maps (fail), unauthenticated plan read (fail), catalog write from client
(fail), share update after create (fail), forged `createdBy` (fail) — plus the happy
paths. **Rules and app deploy as a unit** (deploy-traps lesson: four distinct states —
committed / merged / deployed-rules / deployed-app; never let them split).

### 8c. App Check + abuse/cost ceiling (no-Functions edition)

- **App Check** (reCAPTCHA v3): register in console, initialize in `firebase.ts`
  (debug token in dev). Roll out monitor-first, **enforce for Firestore before testers
  arrive** (house-standard: enforce last, after confirming real traffic passes).
- **Stay on Spark as long as possible**: no billing account = hard quota ceiling = the
  kill switch is built in. The house-standard billing-breaker function becomes relevant only
  at the Blaze upgrade — record it as a pre-Blaze checklist item, don't build it now.
- Rate limiting: without callables there's no transactional limiter; the practical
  ceiling is rules size-caps + App Check + Spark quotas + the client's 600ms debounce.
  Acceptable for beta scale; revisit with Functions if abuse appears.
- **Anonymous account hygiene**: enable Firebase's automatic cleanup of stale anonymous
  accounts (console setting); orphaned plans of reaped anon users are acceptable beta
  debris (document; sweep with an Admin script later if needed).

### 8d. Backups (right-sized)

Catalog/programs are fully regenerable from git (seed JSON) — no backup needed. User
plans are the only real data:
- `scripts/backup-plans.ts` (Admin SDK): dump all `users/*/plans/*` + profiles to a
  dated local JSON under a gitignored `backups/` dir. Run manually before any risky
  change; weekly during beta.
- At Blaze upgrade (pre-launch): enable PITR + daily managed backups, then do ONE
  tested restore into a throwaway database and time it — "a backup you've never
  restored isn't a backup" (vault runbook rule).

### 8e. Hosting headers & bundle hygiene

In `firebase.json` hosting config: `X-Frame-Options: DENY` / `frame-ancestors 'none'`,
HSTS, and a CSP shipped **Report-Only first** (`connect-src`: self,
`*.googleapis.com` for Firestore/Auth, App Check/reCAPTCHA hosts, GA4 collect host;
enforce after ~a week of clean reports — the house-standard rollout order). No source maps
in the prod bundle (Vite default — verify). No PII in console logs; user-facing errors
stay generic (already the app's pattern), detail goes to console only. Sentry: deferred
post-beta (checklist item noted, not built).

### 8f. Pre-tester security pass

Added to the spec 005 beta gate: a re-audit against the relevant subset of the vault's
50-point checklist (items 1–9, 12–16, 26–28, 33–37, 42–46, 49), findings numbered with
file:line + checklist citation, one commit per fix — the house-standard review-cadence format.

## 8g. Roster sync

Roster sync: port `scripts/classagent.tsx` → `scripts/roster-sync.ts` (Admin SDK):
same Cornell API logic and subject list, batch-upsert `courses/*`, then **regenerate**
`catalogIndex` chunks and the denormalized snapshot fields inside each `programs/*` doc.
Preserves hand-authored `prereqExpr`/`coreqExpr` (merge, don't overwrite). Same
credits-as-numeric handling (the NUMERIC(4,1) lesson → plain JS numbers, validate
0 ≤ credits ≤ 20 via Zod).

## 9. Deploy & DEPLOY.md

Fill `docs/DEPLOY.md`: named scripts only (§2), `firebase deploy -P <alias> --only
hosting|firestore:rules`, the fingerprint grep check, hard-refresh-after-deploy habit,
and the rule that rules changes deploy *before* the client code that depends on them.

## 10. Migration execution order (within Phase 2)

1. ~~Firebase project~~ (done — `degree-planner-app`) + `firebase.ts` + env scripts +
   `firebase init` (hosting + firestore) with `.firebaserc`. App still renders (dead data).
2. Schemas + normalizers + seed JSON conversion + `seed-firestore.ts` → seeded dev DB.
3. Port reads: catalog provider + program provider; delete `lib/supabase.ts`,
   `lib/db/*`, `hooks/usePrograms|useProgramData|useCourseSearch` (replaced). App renders
   real data again. ← first "it's alive" checkpoint since May.
4. Rules v1 + emulator test suite green (§8a/8b) + rules deployed. (Before auth ships —
   the data layer goes live behind tested rules, never ahead of them.)
5. Anonymous auth + profile + PlanProvider + store shrink + localStorage import.
6. Google link-upgrade UI + App Check monitor-mode (§8c).
7. `roster-sync.ts` + `backup-plans.ts` (§8d). 8. DEPLOY.md (incl. §8e headers) + first
   hosting deploy + fingerprint grep + App Check enforce decision.
9. Remove `@supabase/supabase-js` from both package.jsons; archive
   `supabase/migrations/` note in STATUS.

## Acceptance checklist
- [ ] Fresh browser, no localStorage: app boots to program list from Firestore, anonymous
      uid created, plan survives a reload and a second device via Google link
- [ ] Old-localStorage browser: plan imported once, not duplicated on re-boot
- [ ] Search returns CS 1110 for "cs 111", "CS-1110", "object"
- [ ] Rules emulator suite green (`npm run test:rules`) — full deny matrix from §8b
- [ ] Cross-uid access denied live (console SDK attempt against deployed rules)
- [ ] App Check initialized (monitor mode minimum); hosting headers present with CSP
      report-only; no source maps in prod bundle
- [ ] `backup-plans.ts` produces a dated dump; `roster-sync.ts --dry-run` shows sane counts
- [ ] Zero `@supabase` imports; zero raw Firestore calls outside `services/`
