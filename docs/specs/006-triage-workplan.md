# Spec 006 — Bug-Triage Workplan (six packages) + State Model & Engine v2

STATUS: IMPLEMENTED (A + B browser-verified 2026-07-07; C–F built by cloud
agents 2026-07-10, code-reviewed with 17 fixes applied same day, pending
local browser verification. Includes two root-cause fixes found along the
way: the dead on-demand course-doc fetch that starved the prereq engine
since the Firestore migration, and the catalog drawer's click-blocking
backdrop + header overlap. LOCAL FOLLOW-UPS: run seed-blank-program +
backfill-slot-categories + roster-sync index rebuild; firestore.rules
changed (inProgressSlotIds + favoriteCourseIds) — DEPLOY rules with the
next hosting deploy.)
Depends on: 005 (Pass B live). Source: bug triage 2026-07-07 (27 items +
#9b + #28), Michael's design decisions this session.

North star (every item measured against this): "How can we make picking a
major the easiest, and remove as much doubtfulness and worry from a
student's path as possible?"

## 0. The six packages (plans of action)

| Pkg | Theme | Triage items | Status |
|-----|-------|--------------|--------|
| A | Quick-fix bug pass | #3, #7, #22, #25, #2 | IMPLEMENTED 2026-07-07 |
| B | State model + engine surfacing | #28, #10, #9, #9b, #24, #5 (canvas half) | IMPLEMENTED 2026-07-07 (browser-verified) |
| C | Auth & save flow | #1, #23, #8 | IMPLEMENTED 2026-07-10, pending local verification |
| D | Card visual language + course detail | #21, #6, #18, #17, #5 (tree half) | IMPLEMENTED 2026-07-10, pending local verification + seed follow-up |
| E | Directory & discovery | #11, #12, #13 | IMPLEMENTED 2026-07-10, pending local verification + index/rules follow-ups |
| F | Canvas & polish | #4, #15, #16, #20, #26 | IMPLEMENTED 2026-07-10, pending local verification + seed run |
| — | Deferred (logged, not scheduled) | #14, #19, #27 | DEFERRED |

Dependency notes: B's legend (#24) lands last inside B. D's tree view (#17)
consumes B's engine output. E's favorites (#13) implements the state
reserved in §1. **D before E** — E's directory rows reuse D's detail
panel. C is independent. F items are independent of everything.

## Package A — Quick-fix bug pass (this session)

Five self-contained fixes, all diagnosed in the triage doc:

- **A1 (#3)** Drag highlights surrounding text → `user-select: none` on the
  drag source / body during active drag. `lib/drag/dragState.ts`,
  `components/drag/DragGhost.tsx`, `CourseCatalog.tsx`.
- **A2 (#7)** "Your plans" selector opens behind the card grid → z-index /
  stacking-context fix. `components/layout/RightSidebar.tsx` vs canvas;
  check for a transformed/positioned ancestor trapping the panel.
- **A3 (#22)** "Save your plan" sticks on "Signing in…" after popup cancel →
  missing catch/finally clearing the loading flag when the popup promise
  rejects. One reset in the shared sign-in handler, `TopBar.tsx`.
- **A4 (#25)** Reset dialog's "clear everything" button grayed/mis-styled →
  button variant fix in the reset confirmation UI (likely `TopBar.tsx` or a
  dialog component).
- **A5 (#2)** Remove CS "111x"-style placeholder slots now that the real
  courses exist in the 4,472-course catalog → seed/template data fix: find
  the placeholder pattern slots in the program templates and swap for the
  real CS courses. Data change, verify the affected majors still render.

## Package B — State model + engine v2 (this session)

The #28 brainstorm output. One state model that #9, #9b, #10, #24, and the
canvas half of #5 all implement against — so the legend is built once.

### 1. State model (decided 2026-07-07)

Manual states — user-set, persisted on the plan doc:
- **Complete** — existing `completedSlotIds`, unchanged.
- **In progress** (NEW) — "currently taking." New `inProgressSlotIds`
  array (cap 150, additive, defaults `[]`). Counts toward prereqs of later
  semesters (already true of any planned course — no evaluator change).
  Progress displays count it separately ("42 earned + 16 in progress");
  it does NOT count as earned credits.
- **Waived** — KEPT exactly as-is in data (`waivedSlotIds`, all counting
  logic untouched). The action is demoted (#9b): removed from the primary
  card action row, relocated to an overflow "⋯" menu on the card. Waived
  remains the only way to mark an empty requirement bucket satisfied.
- **Favorited** — RESERVED. Lives on the course (profile-level), not the
  slot. Implemented with package E (#13). Listed here so the legend design
  accounts for it once.

Derived states — engine-computed, never persisted:
- **Available** — placed, nothing blocking.
- **Blocked / unavailable** (#9's red state) — `prereq === false` OR
  `coreq === false`. Derived, user cannot set it. Do NOT repurpose the
  waived field for this.
- **Warnings** (amber, non-blocking):
  - **Wrong term** — the course's `offered` array (FA/SP/SU/WI tokens,
    already populated by roster-sync from `lastTermsOffered`) does not
    include the placed semester's term. Semester → term mapping: odd
    columns = FA, even = SP. Empty `offered` → no data → no warning.
  - **Semester overload** — column credit total exceeds a cap
    (constant `MAX_SEMESTER_CREDITS = 20`, one place, tunable).

Card display precedence: Complete > In progress > Waived > Blocked (red) >
Warning (amber) > Available.

### 2. Engine — unified status map

`lib/planner/computePrereqStatusMap` grows into `computeSlotStatusMap`:

```
statusMap: Map<slotId, {
  prereq:    true | false | null,   // null = no course / no expr
  coreq:     true | false | null,   // NEW — evaluates coreqExpr for real
  offeredOk: true | false | null,   // NEW — term match, null = no data
  blocked:   boolean,               // prereq === false || coreq === false
}>
semesterCredits: Map<sem, number>
```

- Coreq satisfaction reuses the existing recursive evaluator with the
  same-or-earlier-semester pool (concurrent semantics: a coreq planned in
  the same column satisfies it). Today `coreqExpr` is stored on every
  course but never evaluated — this wires it.
- One hook (`useSlotStatus` or extended `useEffectiveSlots`) feeds
  RoadmapCanvas, SlotCard, EdgeLayer, catalog chips, and the legend.
  Nothing else computes state.
- Unit tests on `computeSlotStatusMap`: coreq met/unmet/concurrent,
  offered match/mismatch/no-data, credit totals, blocked composition.

### 3. UI surfacing (#10 "where is my engine?", #9, #9b)

- **SlotCard blocked**: red status rail + red-tinted card + a message that
  NAMES the missing course(s) — "Needs CS 2110 first" — extracted from the
  unmet leaves of the prereq/coreq tree. Replaces the 12px amber triangle.
  Same data, amplified: this is the entire answer to #10.
- **Action row**: Complete / In progress / Clear primary; Waive/Unwaive in
  the "⋯" overflow (toggle stays `toggleWaived` in PlanProvider).
- **EdgeLayer**: edges feeding a blocked slot render red; coreq
  double-lines reflect evaluated state. Existing hover-chain highlight
  stays; unmet segments in the chain show red.
- **Catalog chips**: same red/amber/green vocabulary as the canvas.
- **SemesterColumn header**: shows the column's credit total; amber past
  the cap.
- **Legend (#24)**: rebuilt once from the unified map — Complete ·
  In progress · Waived · Available · Blocked · Warning.

### 4. #5 split — canvas now, tree with #17

Canvas half (in B): state-colored edges, real coreq evaluation, louder
unmet treatment (above). Tree half (in D/#17): course detail panel shows
the full recursive prereq tree from the 1,088 parsed trees for any course,
placed or not. Not built this session.

### 5. Migration & safety

Purely additive — no destructive migration, no schemaVersion bump
(new field defaults `[]`, old docs pass through):
- `inProgressSlotIds` joins `PlanSchema`, `ShareSchema`,
  `normalizePlan`, `ShareView` counting, and `firestore.rules` (cap 150,
  keep-in-sync comments like the sibling arrays).
- Rules must be DEPLOYED with hosting (the Pass B lesson — rules written
  but not pushed fail closed).
- Security-rule tests add cases for the new field (valid, oversized,
  wrong-type).

### 6. Build order within B

1. Engine: `computeSlotStatusMap` + unit tests (pure logic, no UI risk).
2. Surfacing: SlotCard red/blocked + named-missing-course message,
   EdgeLayer red edges, catalog chips, column credit totals.
3. In-progress state: schema + rules + rules-tests + action row + counts.
4. Waive demotion to overflow menu.
5. Legend rebuild, last, once all states are real.

## Package C — Auth & save flow (#1, #23, #8) — IMPLEMENTED 2026-07-10, pending local verification

Grounding facts: auth is anonymous-by-default with a Google-link upgrade
(`services/auth.ts` — `ensureAnonAuth`, `linkWithGoogle`; popup-cancel
already returns `null`, surfaced by `AuthProvider.linkGoogle()` as
`{ fellBackToSignIn, cancelled }`). There is **no router**, **no modal
component** (all confirms are inline two-step), and **no sign-out**
anywhere in the codebase. Signed-in TopBar shows only a "Hi, {firstName}"
greeting.

### C1. SignInDialog (#1 — decided 2026-07-10: modal, not a page)

- New `components/auth/SignInDialog.tsx` — the app's first true modal:
  `createPortal` to body, **blocking** backdrop (deliberate contrast with
  the catalog drawer's `pointer-events-none` backdrop — modal semantics
  are wanted here), new `--z-modal` token above `--z-topbar` in
  `tokens.css`. Esc / outside-click / × close it.
- Content: headline + value copy (plan saved to your Google account,
  share links, any device), one Google button → `linkGoogle()`. States:
  loading while the popup is open; `cancelled` → dialog stays open, no
  error; `fellBackToSignIn` → success note ("signed into your existing
  account"); error → inline message.
- Open triggers: TopBar "Save your plan" (replaces the direct popup
  call), the account button while anonymous (C3), and any future
  auth-gated action.

### C2. Save-button explicitness (#23)

- The dialog IS the explanation — clicking no longer fires a cold popup.
  Keep a native `title` tooltip ("Sign in with Google to save your plan")
  — no tooltip component exists and none is needed.
- Signed-in the button already disappears (greeting); no disabled state.

### C3. Account button (#8)

- Bottom-left of `LeftSidebar.tsx` (the existing `mt-auto` footer area).
  Reference: house standard — plain, standard shell placement.
- Anonymous: quiet "Sign in" row → opens SignInDialog.
- Signed-in: Google avatar (photoURL, fallback initial) + first name;
  click opens a small portal menu (reuse the CardOverflowMenu idiom:
  portal, fixed anchor, closes on Esc/outside/scroll) with a
  displayName + email header and **Sign out** behind a two-step inline
  confirm (app idiom).

### C4. Sign out (new capability)

- `services/auth.ts` gains `signOutUser()` (firebase `signOut`). After
  sign-out the auth listener fires and `ensureAnonAuth()` boots a fresh
  anonymous session; plan/profile subscriptions tear down and re-resolve
  through the existing uid-keyed effects.
- Signing back in later: fresh anon → `linkWithGoogle` →
  `auth/credential-already-in-use` → existing `signInWithPopup` fallback
  → back to their account. That fallback becomes the *expected* route,
  not just an edge case.
- Verify teardown explicitly: no stale plan writes after the uid switch.

### C5. Scope & verification

- No schema or rules changes. Files: new `SignInDialog.tsx`,
  `TopBar.tsx`, `LeftSidebar.tsx`, `services/auth.ts`,
  `AuthProvider.tsx`, `tokens.css`.
- Browser-verify (subagent): signed-out save → cancel popup → retry →
  sign in; sign out → fresh anonymous canvas; sign back in → plans
  restored.

## Package D — Card visual language + course detail (#21, #6, #18, #17, #5 tree) — IMPLEMENTED 2026-07-10, pending local verification + seed follow-up

Grounding facts: post-B, SlotCard already renders status rail / eyebrow
(code + credits) / title / status line / action row with overflow menu.
Slots carry only `kind: course | pattern | elective` — **no core vs
math-sci category exists** in the data. **No component renders a prereq
tree** (only edges between placed cards). Description / `offered` /
exprs live only on full course docs via `ensureCourseDetails`.

### D1. Category data (#6 — decided 2026-07-10: real data, not kind-derived)

- `SlotSchema` / `ProgramSlot` gain an **optional `category` enum** —
  candidate values `math | science | core | liberal | elective | fws |
  pe`; finalize the exact set against the official flowchart legends
  during backfill and keep it small and shared across majors. Additive:
  old program docs pass through; missing category renders as today.
- Backfill all 13 majors from the 2025 flowcharts via the rerunnable
  seed pipeline; verify against
  `docs/reference/flowcharts/verification-2026-07.md` conventions.
- **Encoding decision**: category = color accent + small tag on the
  card, NOT literal geometric shapes — shapes would break the uniform
  card grid, drag ghost, and drop targets. Category color families join
  `tokens.css` (both themes).

### D2. Card redesign (#21, #6 rides along)

- Card gains: term chips (FA/SP from `offered` — the data is already
  fetched by `useSlotStatus`'s `ensureCourseDetails` call), the D1
  category accent/tag, and a hierarchy pass over eyebrow/title/meta.
  Credits and the B status line stay.
- Spec fixes the *content*, not the pixels: run a short design iteration
  at implementation (screenshot variants, Michael picks).
- Catalog chips adopt the same vocabulary where room allows (credits at
  minimum; chips stay compact).

### D3. Empty-slot affordance (#18)

- Empty pattern/elective slots: explicit "＋ Find a class" hint row
  instead of dead grey. Click opens the catalog drawer pre-filtered to
  the slot's qualifying rule / pattern (uses E's filter model once it
  exists; before E, seeds the search box with the pattern).
- Empty fixed-course slots already show their identity — unchanged.

### D4. CourseDetailPanel + PrereqTree (#17 + the #5 tree half — decided: side-peek)

- New `components/course/CourseDetailPanel.tsx`: right side-peek reusing
  the RightSidebar slide-in pattern (480px, anime.js translate,
  visual-only backdrop). Opened from a canvas card click it slides over
  the canvas; opened from a catalog chip it layers over the drawer with
  a back affordance.
- Content: code, title, credits, description, offered terms, category,
  "counts toward" (matching slot in the current plan), major-relevance
  line (from `useMajorMatch` data), actions: place/arm, complete, waive
  (this is #9b's natural directory-context home), favorite ★ (renders
  once E's favorites land).
- New `components/course/PrereqTree.tsx`: recursive renderer over
  `PrereqExpr` (and / or / course / pattern / concurrent) with met/unmet
  coloring evaluated against the current plan pools (same semantics as
  `computeSlotStatusMap`); patterns render as "CS 111x (any matching)";
  concurrent nodes marked. Renders `coreqExpr` too when present. This is
  the #5 tree half deferred from B, consuming B's engine.
- Click targets: canvas card body (not the action row), catalog chip
  info affordance, and later E's directory rows.

### D5. Build order within D

1. Category schema + backfill (data only, no UI risk).
2. Card redesign #21 + #6 (with the design iteration).
3. Empty-slot affordance #18.
4. Detail panel + prereq tree #17.

## Package E — Directory & discovery (#11, #12, #13) — IMPLEMENTED 2026-07-10, pending local verification + index/rules follow-ups

Grounding facts: no router — `/s/<id>` is a manual regex in
`app/App.tsx`. The catalog index is fully in memory (4,472 records:
id / subject / number / title / creditsMin/Max / hasPrereqs — **no
`offered`**). Search is a 40-cap substring match with zero filters.
Profile doc exists at `users/{uid}` with a rules-mirrored key allowlist.
**D ships before E** — E's rows reuse D4's detail panel.

### E1. Routing (decided 2026-07-10: adopt react-router)

- Add `react-router-dom`. Routes: `/` (planner shell), `/s/:shareId`
  (ShareView — keep it outside the heavy provider stack as today),
  `/classes` (directory). Unknown paths redirect `/`.
- Replaces the manual regex in `app/App.tsx`. Left sidebar gains nav
  links (Planner / Classes).

### E2. Classes page (#11)

- Full directory over the in-memory index: incremental rendering
  ("load more" batches of ~100 — no virtualization dependency), sorted
  subject + number. Row: code, title, credits, prereq dot, term chips
  (needs E3's data), favorite star (E4). Row click → CourseDetailPanel.
- Reuses `CatalogProvider.search`; the 40-result cap becomes a
  parameter so the page can lift it.

### E3. Filters (#12)

- New `hooks/useCourseFilters.ts` — one filter model + predicate over
  index records, shared by `/classes` and the catalog drawer: subject,
  level (first digit of number), credits, offered term, has-prereqs,
  favorites, "relevant to my major" (matches open slots' qualifying
  rules for the selected program).
- Data gap: index records lack `offered` → add it to the catalogIndex
  chunk schema (additive) and rebuild via roster-sync. Chunk count stays
  ~5 reads per boot.
- `useCourseSearch` grows a filters param. Drawer UI = compact filter
  chip row; `/classes` = fuller filter bar.

### E4. Favorites (#13 — implements the state reserved in B §1)

- `favoriteCourseIds: string[]` (cap 200) on the profile doc:
  `UserProfileSchema` allowlist, `firestore.rules` (+ keep-in-sync
  comments like the plan arrays), rules tests (valid / oversized /
  wrong-type), a toggle helper in `services/profile.ts`.
- Works for anonymous users (they have a uid) and survives the Google
  upgrade (same uid) — no sign-in gating.
- Affordances: star on catalog chip hover, directory row, detail panel;
  a "Favorites" filter chip in both surfaces.
- **RULES DEPLOY with the next hosting deploy** (the Pass B lesson).
- Waive-from-directory (#9b's note) lands as D4's "counts toward →
  waive" action in the detail panel, not as a directory-row action.

### E5. Build order within E

1. Router + `/classes` skeleton over the index.
2. Filter model + `offered`-in-index rebuild.
3. Favorites last, so one rules deploy covers the package.

## Package F — Canvas & polish (#4, #15, #16, #20, #26) — IMPLEMENTED 2026-07-10, pending local verification + seed run (items independent)

### F1. Failed-drop return animation (#4)

- `dragState.start` / `startSlotMove` capture the source rect
  (`originRect`) at drag start. DragGhost's no-valid-target branch
  (today: scale/fade vanish) instead springs x/y back to `originRect`,
  settles, then `dragState.end()`. Fallbacks: origin unavailable (drawer
  closed mid-drag) → keep the vanish; `prefersReducedMotion` → instant.

### F2. Zoom-out (#15)

- Zoom presets (100 / 85 / 70 / 55%) via `transform: scale(z)`,
  `transform-origin: top left` on the canvas content element, wrapped in
  a sizing div (width = content width × z) so scroll extents track.
- **EdgeLayer `measure()` must divide rect deltas by z** — arrows
  misalign otherwise (it uses raw `getBoundingClientRect` deltas);
  re-measure on zoom change (layoutVersion bump). `elementsFromPoint`
  drag hit-testing is unaffected (it works on rendered layout).
- Control: small segmented control in a canvas corner; zoom persisted in
  `usePlannerStore` (localStorage).

### F3. Dark mode + hover polish (#16)

- Scrollbars are completely unstyled today. Add scrollbar tokens
  (`--scrollbar-thumb/track`) to `tokens.css` for both themes +
  `::-webkit-scrollbar` / `scrollbar-color` rules; audit hover states
  (catalog chip in dark, side-peek hover, plan-menu rows).

### F4. TopBar polish (#20)

- Symmetric padding centered to `--topbar-h` (today `pb-3 pt-6`);
  migrate one-off raw buttons to the `Button` primitive; reserve widths
  for swap-label confirms ("Clear everything?", share cooldown) so the
  bar stops jumping; fix the absolutely-positioned program label; move
  the plan dropdown's literal `z-40`/`z-50` onto the token z-scale.

### F5. Blank canvas (#26 — decided 2026-07-10: seeded blank program)

- Seed a real program doc `blank` ("Start from scratch") with zero slots
  and no edges — every `programId` gate (PlanProvider resolution,
  LeftSidebar, RoadmapCanvas/FirstRun) works unchanged. Rejected
  alternative: first-class null-program plans (touches every gate).
- FirstRun gets a "start from a blank canvas" card under the majors
  grid.
- Building uses existing paths: drag from catalog onto a column →
  `addCustomSlot` (cap 40, semesters 1–10). LeftSidebar credit target
  falls back to 120. Major Match keeps ranking majors against what's
  placed — the north-star nudge toward picking a major.
- Cap note: 40 custom slots is acceptable for scratch plans; revisit
  only if testers hit it.

## Deferred (logged, not scheduled)

- **#14** external reviews/rankings (RateMyProfessor etc.) — licensing +
  pipeline questions.
- **#19** auto-fill / plan generator.
- **#27** compare plans/majors by classes of interest — big north-star
  differentiator, needs its own brainstorm when scheduled.
