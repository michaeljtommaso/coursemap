# Implementation Status Directory

> Living directory of every spec/plan doc and its real state in the code.
> Statuses: IMPLEMENTED · PARTIAL (list what's left) · NOT BUILT ·
> DEFERRED · SUPERSEDED. Update when a spec/plan changes state; each doc
> also carries its own `STATUS:` banner.

| Doc | Status | Notes |
|---|---|---|
| docs/PRODUCT.md | — | Product overview (current, keep) |
| docs/DESIGN.md | PARTIAL (implemented in code) | Token system + DM Sans/Mono now live (spec 003, Phase 1); has an "Implementation" section pointing at tokens.css + tailwind.config.ts. Layout/component-anatomy specifics still target spec 004 |
| docs/specs/000-revival-direction.md | ACTIVE | Master direction doc; governs 001–005; contains audit summary + phasing |
| docs/specs/001-cleanup-build-health.md | IMPLEMENTED | Phase 0 done 2026-07-07 (branch phase-0-cleanup): deleted 25 dead files, cut the trash subsystem, fixed the DragGhost type error, added persist version/migrate to all 3 stores + null guards; `npm run build` green, lucide-react confirmed genuine |
| docs/specs/002-firebase-migration.md | PARTIAL (stage 1 — reads live; auth/plans pending) | Phase 2 stage 1 done 2026-07-07 (branch phase-2-firebase): §10 steps 1–4. Firebase wiring + committed public env + firebase.ts; Zod schemas (.passthrough + rules-mirrored caps) + normalizers (camelCase Firestore → snake_case app types); SQL→JSON seed converter + Admin SDK seeder (seeded live degree-planner-app in nam5, counts 50/4/4/19/162/70); firestore.rules v1 + 20-case emulator deny matrix (green, `cd rules-tests && npm run test:rules`) + rules deployed; reads ported to services/{catalog,programs}.ts → CatalogProvider/ProgramProvider → thin hooks (same {data,loading,error,refetch} signatures), lib/supabase.ts + lib/db/* deleted, @supabase removed from the APP package.json. Build green; Playwright-verified live (4 programs, CS 42-slot grid, search "cs 21"/"object"→CS 2110). Stage 2 pending (§10 5–9): anon+Google auth, PlanProvider+cloud plans+store shrink, localStorage import, App Check, roster-sync, backups, hosting deploy, Analytics, remove @supabase from scripts/ |
| docs/specs/003-design-system-tokens.md | IMPLEMENTED | Phase 1 done 2026-07-07 (branch phase-1-tokens): src/styles/tokens.css (light :root + .dark re-declaration), DM Sans/DM Mono self-hosted via @fontsource, Tailwind semantic bridge + shadcn HSL aliasing bridge, .t-*/.num type utilities. All 8 active components migrated off raw palette classes (grep gate: zero hits). Quick wins: neutral semester headers, error-with-retry (usePrograms/useCourseSearch/useProgramData refetch), Skeleton primitive, two-step inline Reset confirm, unmet-prereq dot → ink-4, canvas dot-grid via --canvas-dot. Build green; DM Sans verified via computed style |
| docs/specs/004-ui-redesign.md | NOT BUILT | Phase 3 — CSS-grid canvas, slot card anatomy, first-run, click-to-place |
| docs/specs/005-product-features.md | NOT BUILT | Phase 4 — credits, Major Match, prereq chips, waive UI, share links, beta gate |
| docs/handoffs/HANDOFF.md | SUPERSEDED | Describes the pre-Supabase prototype (React Flow/dnd-kit era) — historical only |
| docs/handoffs/handoff-2026-05-17.md + session2 | — | Accurate record of the current architecture (custom canvas + Supabase era) |
| docs/handoffs/classagent.md | PARTIAL | Roster sync script exists (`scripts/classagent.tsx`, Supabase-targeting); port to Firebase Admin SDK per spec 002 §8 |
