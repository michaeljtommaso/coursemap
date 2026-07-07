# Implementation Status Directory

> Living directory of every spec/plan doc and its real state in the code.
> Statuses: IMPLEMENTED · PARTIAL (list what's left) · NOT BUILT ·
> DEFERRED · SUPERSEDED. Update when a spec/plan changes state; each doc
> also carries its own `STATUS:` banner.

| Doc | Status | Notes |
|---|---|---|
| docs/PRODUCT.md | — | Product overview (current, keep) |
| docs/DESIGN.md | NOT BUILT (target) | Design system doc; audit 2026-07-07 confirmed its token system was never implemented — treat as the target of specs 003/004, not a description of the app |
| docs/specs/000-revival-direction.md | ACTIVE | Master direction doc; governs 001–005; contains audit summary + phasing |
| docs/specs/001-cleanup-build-health.md | NOT BUILT | Phase 0 — delete dead cluster (~16 files), fix build, persist versioning |
| docs/specs/002-firebase-migration.md | NOT BUILT | Phase 2 — Firestore model, seed pipeline, auth, cloud plans (Supabase project is dead: NXDOMAIN) |
| docs/specs/003-design-system-tokens.md | NOT BUILT | Phase 1 — token layer, DM Sans/DM Mono, error honesty, skeletons |
| docs/specs/004-ui-redesign.md | NOT BUILT | Phase 3 — CSS-grid canvas, slot card anatomy, first-run, click-to-place |
| docs/specs/005-product-features.md | NOT BUILT | Phase 4 — credits, Major Match, prereq chips, waive UI, share links, beta gate |
| docs/handoffs/HANDOFF.md | SUPERSEDED | Describes the pre-Supabase prototype (React Flow/dnd-kit era) — historical only |
| docs/handoffs/handoff-2026-05-17.md + session2 | — | Accurate record of the current architecture (custom canvas + Supabase era) |
| docs/handoffs/classagent.md | PARTIAL | Roster sync script exists (`scripts/classagent.tsx`, Supabase-targeting); port to Firebase Admin SDK per spec 002 §8 |
