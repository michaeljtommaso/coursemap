# Deploying Cornell Degree Planner

> STATUS: LIVE (Firebase Hosting). Follow this file exactly — never improvise
> deploy commands. Every command names its environment explicitly; there is no
> implicit "current env".

The app is hosted on **Firebase Hosting**, project **`degree-planner-app`**
(single project for now — `default` alias in `.firebaserc`; a separate
`production` project lands at Phase 5 and is then a pure env/alias swap).

## Local dev
Default to the **local emulators**. Development, the e2e suite and browser QA
then never spend the live project's daily Firestore quota (Spark: 50,000
reads/day, shared with the live site) and never create accounts in it.

```
npm --prefix cornell-degree-planner run emulators      # Firestore :8080 + Auth :9099
# from scripts/, once per emulator start (data is not persisted):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx seed-emulator.ts
npm --prefix cornell-degree-planner run dev:emu         # http://localhost:5180
npm --prefix cornell-degree-planner run test:e2e        # targets :5180 by default
```

`seed-emulator.ts` loads the newest `scripts/backups/catalog-backup-*.json`
(`--from <file>`, `--courses-from <file>` to override) and refuses to run
without `FIRESTORE_EMULATOR_HOST`. `dev:emu` uses `.env.emulator`, a
self-contained placeholder config, so it can't reach the live project. The
pipeline scripts (`parse-prereqs`, `audit-prereqs`, `seed-programs-2025`, `roster-sync`) also
target the emulator when `FIRESTORE_EMULATOR_HOST` is set, which is how a live
data change can be rehearsed end to end first.

Against the live project (opt-in): `npm --prefix cornell-degree-planner run dev`
(port 5173 is taken by another app on the main dev machine; add `-- --port 5180`).

## Named scripts only (never raw `vite build` / `firebase deploy`)

From `cornell-degree-planner/`:

```
npm run build:dev     # vite build --mode development  (bakes .env.development)
npm run build:prod    # vite build --mode production   (bakes .env.production)
npm run deploy:dev    # build:dev  + firebase deploy -P default --only hosting
```

`build:dev` / `build:prod` run `typecheck` first, so a type error fails the build
before anything is published. `deploy:dev` is the current path (dev + prod both
point at `degree-planner-app` until the prod project exists). Build output:
`cornell-degree-planner/dist/` (gitignored).

## The four-state discipline (merged ≠ live)

A change passes through four DISTINCT states. Never let them silently split — a
green local build says nothing about what's live:

1. **committed** — in your branch.
2. **merged** — on the integration branch / main.
3. **deployed-rules** — `firestore.rules` pushed to the project.
4. **deployed-app** — the built client pushed to Hosting.

After any deploy, confirm the state you think you're in (fingerprint grep below).

## Rules deploy BEFORE the app that depends on them

Security rules are the server-side boundary (no Cloud Functions). Any client
change that relies on a rules change must ship rules FIRST:

```
# From the repo root:
npx firebase-tools deploy --only firestore:rules --project degree-planner-app
# …verify, THEN deploy the app:
npm --prefix cornell-degree-planner run deploy:dev
```

The data layer goes live behind tested rules, never ahead of them. Run the rules
suite green before deploying rules: `cd rules-tests && npm run test:rules`.

## Fingerprint grep (prove which project a deploy hit)

`index.html` carries `<meta name="fb-project" content="%VITE_FB_PROJECT_ID%">`,
substituted at build time. After a deploy, grep the SERVED HTML:

```
curl -s https://degree-planner-app.web.app/ | grep 'fb-project'
# expect: <meta name="fb-project" content="degree-planner-app" />
```

If the content doesn't match the project you meant to deploy to, STOP — you
deployed to the wrong target.

## Hard-refresh habit

Hosting sets long cache lifetimes on hashed assets. After a deploy, hard-refresh
(Ctrl/Cmd+Shift+R) before judging whether a change is live — a stale cached
bundle is the #1 cause of "my deploy didn't work" false alarms.

## Auth prerequisite (one-time, console-only)

Anonymous + Google sign-in must be enabled in **Firebase console →
Authentication → Sign-in method**. On the free Spark tier this is a Console click
that CANNOT be done via the Admin/Identity-Toolkit REST API (it returns
`BILLING_NOT_ENABLED` / `CONFIGURATION_NOT_FOUND` until the project is on Blaze).
Until it's enabled, the app boots but `signInAnonymously()` rejects with
`auth/operation-not-allowed` and cloud plans can't save.

## App Check (spec 002 §8c)

App Check (reCAPTCHA v3) initializes only when `VITE_FB_APPCHECK_SITE_KEY` is set
(see `.env.*`). Register App Check in the console, add the site key to
`.env.production`, roll out **monitor-first**, and **enforce for Firestore before
testers arrive** — after confirming real traffic passes. Hosting also ships a CSP
in **Report-Only** mode first (`firebase.json` headers); enforce it after ~a week
of clean reports.

## Admin scripts (not part of a deploy)

Authenticate via `GOOGLE_APPLICATION_CREDENTIALS` → the service-account key in
a local secrets folder outside the repo (never committed, never echoed). From `scripts/`:

```
npx tsx seed-firestore.ts --dry-run     # catalog/programs seed (idempotent)
npx tsx roster-sync.ts    --dry-run     # Cornell roster → courses (LIVE is a beta-gate call)
npx tsx backup-plans.ts                 # dump user plans to gitignored backups/
npx tsx verify-seed.ts                  # spot-check seeded state
npx tsx seed-programs-2025.ts --dry-run # the 2025 major templates (programs/*)
npx tsx seed-programs-legacy.ts         # the 4 legacy 2026 templates; --apply writes, snapshots from the catalog
npx tsx seed-aliases.ts                 # catalog/meta.aliases only; --apply writes
```

A **live** `roster-sync` rewrites the whole course catalog — treat it as a
beta-gate decision, not routine.

**Read budget.** Every full-catalog script reads ~4,850 docs (parse-prereqs,
a live roster-sync's index rebuild, `--add-only`'s id read, full backups).
Spark allows 50,000 reads/day for the whole project, live site included; on
2026-10-10 a day of dry runs exhausted it and the live site couldn't read until
midnight Pacific. Rehearse on the emulator, dry-run offline
(`parse-prereqs.ts --from-file`), and keep live full-catalog runs to a handful
per day.

## Historical

SQL migrations under `scripts/legacy-sql/` are historical source data only —
Firestore (seeded from the derived JSON) is canonical. The Supabase backend is
gone; never point deploy or runtime at it.
