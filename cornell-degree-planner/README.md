# cornell-degree-planner: the Coursemap web app

The React + TypeScript + Vite client. See the repository root README for the product overview and architecture.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (needs Firebase web config in `.env.local`) |
| `npm run typecheck` | `tsc --noEmit` against the app tsconfig |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck, then a production bundle into `dist/` |

## Source layout

| Path | Role |
|---|---|
| `src/lib/planner/` | Pure planning engines: prerequisite evaluation, major matching, graph derivation, time horizons, conflicts. No React, fully unit-tested. |
| `src/services/` | The only modules that talk to Firebase (catalog, programs, plans, profile, shares, auth) |
| `src/contexts/`, `src/hooks/` | Session-owned providers and the hooks that join services to engines |
| `src/components/` | UI: the roadmap canvas, catalog, course side-peek, majors panel, dialogs |
| `src/lib/normalize/`, `src/lib/schemas.ts` | Read-boundary normalization and Zod schemas for every Firestore document |
| `src/styles/` | The design-token layer (light/dark CSS variables) and global styles |

Deploying is covered in `docs/DEPLOY.md` at the repo root. Use the named scripts only.
