# Coursemap docs

These are the design and engineering documents behind Coursemap. Features are built **spec-first**:

1. **Audit:** a structured pass over the running app (bugs, gaps against the product thesis, measured data
   problems), with root causes traced to file and line.
2. **Spec:** a decision record for one feature. It covers the problem, the options weighed, what was decided and why,
   what's out of scope, and a `STATUS:` banner kept in sync with the code.
3. **Build:** implemented in small reviewed units against tests, then verified in a real browser.
   [`reference/implementation-status.md`](reference/implementation-status.md) tracks every spec's real state.

Working notes (session logs, handoffs, the running status log, internal planning) live in the private repo and aren't
published; see the [main README](../README.md#about-this-repository).

## Start here

| If you want… | Read |
|---|---|
| What the product is and why | [`PRODUCT.md`](PRODUCT.md) → [`audits/2026-07-11-product-thesis.md`](audits/2026-07-11-product-thesis.md) |
| The deepest technical write-up | [`specs/011-major-discovery-engine.md`](specs/011-major-discovery-engine.md): bipartite major matching, the requirement schema, the authoring pipeline |
| A debugging write-up | [`audits/2026-07-12-drag-system-audit.md`](audits/2026-07-12-drag-system-audit.md): a pointer-capture drag bug traced to root cause |
| The security model | [`specs/002-firebase-migration.md`](specs/002-firebase-migration.md) §8: rules, hardening, cost controls |

## Specs

| # | Spec | What it covers |
|---|---|---|
| 000 | [Revival direction](specs/000-revival-direction.md) | Master direction after a full audit: architecture choices and phasing for 001–005 |
| 001 | [Cleanup & build health](specs/001-cleanup-build-health.md) | Dead-code removal, type fixes, persisted-state versioning |
| 002 | [Firebase migration](specs/002-firebase-migration.md) | Supabase → Firestore data model, security rules, auth, backups, hardening |
| 003 | [Design system tokens](specs/003-design-system-tokens.md) | CSS-variable token layer, dark mode, Tailwind bridge |
| 004 | [UI redesign](specs/004-ui-redesign.md) | CSS-grid canvas, card anatomy, click-to-place, empty states |
| 005 | [Product features](specs/005-product-features.md) | Credits, Major Match v1, share links, plan switching |
| 006 | [Triage workplan](specs/006-triage-workplan.md) | A 27-item bug triage turned into six work packages |
| 007 | [Prerequisite data trust](specs/007-prereq-data-trust.md) | Parser overhaul, advisory prerequisites, AP/IB credit profile, one satisfaction function |
| 008 | [The living graph](specs/008-living-graph.md) | Prerequisite edges derived at render time; hover shows what a course unlocks |
| 009 | [The cage comes off](specs/009-cage-comes-off.md) | The major template becomes a suggestion: replace-with-undo, safe major switching |
| 010 | [Attribute requirements & roster ingest](specs/010-attribute-requirements-roster-ingest.md) | Requirements matched on course attributes; full section and instructor ingest |
| 011 | [Major discovery engine](specs/011-major-discovery-engine.md) | Bipartite major matching, requirement schema, onboarding |
| 012 | [Time-horizon enrollment](specs/012-time-horizon-enrollment.md) | Near and far data horizons per card; schedule-conflict detection |

## Audits

| Audit | What it is |
|---|---|
| [2026-07-07 bug triage](audits/2026-07-07-bug-triage.md) | 27 issues from hands-on testing, each diagnosed to file level |
| [2026-07-11 product thesis](audits/2026-07-11-product-thesis.md) | The founding problem and the time-horizon model |
| [2026-07-11 vision gap & graph audit](audits/2026-07-11-vision-gap-and-graph-audit.md) | Code and data audit against the thesis, including a measured Cornell API field audit |
| [2026-07-12 drag system audit](audits/2026-07-12-drag-system-audit.md) | Root-cause analysis of a drag-and-drop failure |

## Product, design & operations

- [`PRODUCT.md`](PRODUCT.md): product overview, users and principles
- [`DESIGN.md`](DESIGN.md): the original design-language spec (since evolved into the Coursemap brand; see `design/`)
- [`design/claude-design-2026-07-11/`](design/claude-design-2026-07-11/IMPLEMENTATION-MAP.md): card and logo
  explorations and the map from prototype to production components
- [`DEPLOY.md`](DEPLOY.md): the deploy runbook (rules first, named scripts only, a post-deploy fingerprint check)
- [`reference/program-coverage.md`](reference/program-coverage.md): generated satisfiability report for every major
- [`reference/flowcharts/`](reference/flowcharts/README.md): how authored requirements were checked against Cornell's
  official flowcharts
