# Spec 000 — Revival Direction (Master Doc)

STATUS: ACTIVE (direction doc — governs specs 001–005)
Date: 2026-07-07
Author: Deep audit session (3 parallel audits: code+Supabase inventory, UI/UX vs DESIGN.md, house conventions)

---

## 1. Where the project actually stands

### The blocker nobody knew about
**The Supabase project is dead.** `<old-project>.supabase.co` no longer resolves
(NXDOMAIN — deleted or reclaimed after free-tier inactivity). The app cannot load a single
row of data today. Nothing is lost — the entire catalog lives in
`supabase/migrations/002_seed.sql` (~50 courses, 4 programs, 19 elective groups,
162 slots, 70 edges) — but there is no live backend to migrate *from*. This converts the
Supabase→Firebase migration from a preference into mandatory step one, and simplifies it:
we rebuild the data layer on Firebase directly from the seed files. No dual-running, no
cutover risk.

### What's healthy (don't rebuild these)
- **The app bundles and runs.** `vite build` succeeds cleanly (486 KB / 144 KB gzip).
  Only `tsc -b` fails — 20 errors, 19 of them in dead legacy files, 1 trivial type
  mismatch in `DragGhost.tsx`.
- **The relational data model is genuinely good.** Global `courses` dictionary separated
  from per-program `program_slots`; the `kind` discriminator (course/pattern/elective)
  matches how Cornell flowcharts actually work; `prereq_expr` recursive AND/OR trees are
  the right abstraction; `slot_edges` smartly separates visual arrows from logical
  prereqs. This model ports to Firestore nearly verbatim.
- **The drag/motion layer is polished.** Custom pointer-event system, anime.js ghost with
  velocity tilt, snap-to-slot springs. It feels premium. It has debt (pointer-only, no
  auto-scroll) but the core is keepable.
- **DESIGN.md is a strong design system document** — "Scholar's Vellum" palette, named
  rules, per-component specs. Problem: it was never implemented (see below).

### What's broken or missing
1. **No backend** (above).
2. **No user-data layer at all.** `user_plans` tables were never uncommented; everything
   lives in localStorage on one device. No accounts, no multi-plan, no sharing. You
   cannot give this to testers and learn anything — their plans evaporate per-device and
   you have zero visibility.
3. **The design system is aspirational fiction.** DESIGN.md's token frontmatter (vellum
   oklch palette, DM Sans, semantic status colors) has zero corresponding implementation.
   `tailwind.config.ts` is stock shadcn. **DM Sans is never loaded** — the app renders in
   system fonts. Components hardcode raw Tailwind palettes (`emerald-300`, `sky-50`)
   across ~8 files.
4. **Error states are dishonest.** `usePrograms` and `useCourseSearch` swallow failures
   into empty states — a dead database is indistinguishable from "no results." (This is
   exactly why the dead Supabase went unnoticed.)
5. **~16 dead files** from the pre-Supabase prototype (two parallel data models in one
   src tree), 6 of which break the build.
6. **Zero keyboard/touch path** for the core interaction. Pointer-only drag; touch users
   can't even scroll the catalog (chip `pointerdown` calls `preventDefault`).
7. **Major Match — the product's entire differentiator — is a placeholder box.**
8. **No persist versioning** on any Zustand store; the persisted `selectedCourses` cache
   can serve stale course data forever.

Full details: the three audit reports are summarized inline in specs 001–005 where they
drive requirements.

---

## 2. Direction

**Thesis (unchanged, and worth keeping):** course-first degree planning. Students pick
courses they love; the tool shows where they lead and which major fits. PRODUCT.md's
framing is strong — keep it.

**Target state for "hand to testers":** a Cornell student opens a link, immediately sees
a roadmap for a program (or starts from courses), plans by drag OR click, sees credit
loads and prereq status, gets a live Major Match ranking, signs in with one tap
(anonymous auth upgradeable to Google) so the plan survives devices, and can share a
read-only link. You can see usage because plans live in Firestore.

**Architecture direction:** adopt my standard Firebase app conventions
with deliberate exceptions:

| Decision | Choice | Why |
|---|---|---|
| Backend | Firebase: Firestore + Auth + Hosting. **No Cloud Functions in v1.** | Every user write is a self-write to the user's own docs — per my own house rule ("match the write mechanism to the trust boundary"), callables are unnecessary. Catalog writes happen only via Admin SDK scripts. Bonus: stays on the free Spark plan. |
| Data layer | house-standard services → hooks → session-owned providers, with `normalize<Entity>` read-boundary functions and Zod `.passthrough()` schemas from day one | The field-shape-mismatch lesson is exactly the bug class a Postgres→Firestore port invites. |
| State | **Keep Zustand** (deviation from house-standard Context/uSES) | It's already here, working, v5, with persist. Swapping state libraries mid-migration is churn without payoff. Zustand keeps UI-only state; plan data moves behind a Firestore-backed provider (spec 002 §6). |
| Styling | Keep Tailwind v3, but drive it from a real CSS custom-property token layer (house-standard token conventions × DESIGN.md palette) | DESIGN.md becomes true instead of aspirational. Dark mode = full token re-declaration, components never branch. |
| Canvas | Replace absolute-position pixel math with real CSS grid semester columns; keep the SVG edge overlay and the anime.js drag ghost | Kills the fixed 200×90 fragility, enables sticky headers and flexible card heights, keeps what's good. |
| Design language | DESIGN.md "Scholar's Vellum" stays the north star, now actually implemented; adopt the house-standard mono-numerals signature (DM Mono, tabular-nums) for credits/counts | DESIGN.md already reserves DM Mono for numeric display; house-standard proved mono numbers are a cheap, high-recognition signature. |

**Product scope calls (my critique — cut/keep/add):**

CUT for v1:
- **Trash bin subsystem.** Deletion is only discoverable mid-drag, and every slot already
  has an inline ✕. Two delete mechanisms, one hidden. Removing it deletes a whole
  subsystem (TrashBin.tsx + trash branches in DragGhost/AppShell/dragState). Net simplification.
- **Custom templates (defer, don't delete).** Half-built (8×5 hardcoded grid, no rename
  UI, contents keyed to synthetic IDs). It dilutes the course-first thesis and competes
  with real programs for attention. Park behind the multi-plan model in spec 005; revisit
  after tester feedback.
- **Sky/amber season-coding on semester headers.** Violates the design system's own
  Chart Signal Rule. Season becomes a text tag.

KEEP (and finish):
- Waived status — advisors waive requirements constantly; it's modeled and styled but has
  no UI trigger. Add one (spec 004).
- The drag ghost — trim (no trash branch), don't rebuild.
- The 4 seeded programs (CS/ECE/ME/ORE) as launch scope.

ADD (ranked by product value):
1. **Auth + cloud plans + localStorage import** (spec 002) — the tester prerequisite.
2. **Per-semester credit tracking** (spec 005) — a planner's #1 job ("am I at 12–18
   credits?"); cheap to build, data already exists.
3. **Major Match, for real** (spec 005) — the differentiator, currently vaporware.
4. **Click-to-place path** (spec 004) — fixes keyboard, touch, AND discoverability in one
   feature; drag becomes the delightful fast path, not the only path.
5. **Prereq-aware catalog + coreq validation** (spec 005) — `evaluatePrereq` already
   exists and works; wire it. Fix the `concurrent` no-op.
6. **Read-only share link** (spec 005) — the viral loop for testers.
7. **Roster sync on Admin SDK** (spec 002) — port classagent; real descriptions and
   credits at scale.

---

## 3. Phasing (each phase ends runnable + committed + pushed)

| Phase | Spec | Scope | Size |
|---|---|---|---|
| 0 | 001 | Delete dead cluster (~16 files), fix build, guard rails (persist versions, null guards, lucide-react identity check) | ~half session |
| 1 | 003 | Token pipeline + DM Sans/DM Mono + quick visual wins (headers, error honesty, confirm dialog) | ~1 session |
| 2 | 002 | Firebase projects, Firestore model, seed pipeline from SQL, port reads, anonymous auth, cloud plans, localStorage import | ~2–3 sessions |
| 3 | 004 | Canvas re-layout (CSS grid), slot card redesign, onboarding/empty states, catalog UX, click-to-place, remove trash | ~2 sessions |
| 4 | 005 | Credits, Major Match, prereq chips, waive UI, share links, roster sync | ~2 sessions |
| 5 | — | Beta hardening: responsive posture, a11y pass, deploy, invite testers | ~1 session |

Order rationale: tokens (1) before Firebase (2) is deliberate — Phase 1 is small, makes
every subsequent screenshot/review look right, and Phase 2 touches the same components'
data plumbing, so doing tokens first avoids double-passes. Phases 2 and 3 could swap if
you'd rather see the redesign before backend work — but nothing loads data until Phase 2,
so the app is only *visually* reviewable until then.

## 4. Open questions for Michael

1. **Hosting**: Firebase Hosting assumed (matches house-standard deploy conventions). Confirm —
   DEPLOY.md is currently empty.
2. **Two Firebase projects (dev/prod) or start with one?** Conventions say two; for a
   pre-tester phase one is defensible. Spec 002 assumes two but sequences prod setup last.
3. **Auth providers**: anonymous + Google assumed. Add Cornell email magic-link?
4. **Does "give to people to test" imply any analytics?** Spec 005 proposes a minimal
   `plans` telemetry read (count/last-active via console), not an analytics SDK.

## 5. Doc housekeeping done in this session
- This spec set: 000 (direction) · 001 (cleanup) · 002 (Firebase) · 003 (tokens) ·
  004 (UI redesign) · 005 (features), all registered in
  `docs/reference/implementation-status.md`.
- HANDOFF.md (root) describes the pre-Supabase prototype and is **historical** — the
  2026-05-17 pair is the accurate architecture record. Marked in implementation-status.
- DESIGN.md is reclassified: it is the *target* to implement (spec 003/004), not a
  description of current state.
