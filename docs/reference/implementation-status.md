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
| docs/specs/002-firebase-migration.md | IMPLEMENTED | Phase 2 done 2026-07-07: Firestore seeded (nam5), rules tested+deployed, reads+auth+cloud plans live, hosting deployed (degree-planner-app.web.app). Verified live: plan round-trip, localStorage import, Google popup. Beta-gate leftovers in spec 005 |
| docs/specs/003-design-system-tokens.md | IMPLEMENTED | Phase 1 done 2026-07-07 (branch phase-1-tokens): src/styles/tokens.css (light :root + .dark re-declaration), DM Sans/DM Mono self-hosted via @fontsource, Tailwind semantic bridge + shadcn HSL aliasing bridge, .t-*/.num type utilities. All 8 active components migrated off raw palette classes (grep gate: zero hits). Quick wins: neutral semester headers, error-with-retry (usePrograms/useCourseSearch/useProgramData refetch), Skeleton primitive, two-step inline Reset confirm, unmet-prereq dot → ink-4, canvas dot-grid via --canvas-dot. Build green; DM Sans verified via computed style |
| docs/specs/004-ui-redesign.md | IMPLEMENTED | Phase 3 done 2026-07-07 (branch phase-3-ui, overnight pass): semester columns, SlotCard, living edges, click-to-place, first-run, plan identity, Catalog/Majors tabs. Deferred: jump-to-semester strip, arrow-key nav |
| docs/specs/005-product-features.md | IMPLEMENTED | Passes A+B done 2026-07-07. Beta-gate items deferred to invite day: App Check enforce, CSP enforce, manual Google-login test |
| docs/specs/006-triage-workplan.md | PARTIAL | Spec'd 2026-07-07 from the bug triage (27 items → 6 packages). Packages A (quick fixes) + B (state model / engine v2) are the active targets; C–F scoped for future sessions; #14/#19/#27 deferred |
| docs/handoffs/HANDOFF.md | SUPERSEDED | Describes the pre-Supabase prototype (React Flow/dnd-kit era) — historical only |
| docs/handoffs/handoff-2026-05-17.md + session2 | — | Accurate record of the current architecture (custom canvas + Supabase era) |
| docs/handoffs/classagent.md | IMPLEMENTED (superseded) | Roster sync ported to Firebase Admin SDK as `scripts/roster-sync.ts` (spec 002 §8g, done 2026-07-07); old Supabase-targeting `scripts/classagent.tsx` deleted. Same Cornell API + 13 subjects; merge-upsert preserving hand-authored prereqExpr/coreqExpr; regenerates catalogIndex + program slot snapshots; `--dry-run` verified (622 courses). Live full sync is a beta-gate call — not run yet |
