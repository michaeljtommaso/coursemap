# Deploying Cornell Degree Planner

> STATUS: LIVE (Firebase Hosting). Follow this file exactly — never improvise
> deploy commands. Every command names its environment explicitly; there is no
> implicit "current env".

The app is hosted on **Firebase Hosting**, project **`degree-planner-app`**
(single project for now — `default` alias in `.firebaserc`; a separate
`production` project lands at Phase 5 and is then a pure env/alias swap).

## Local dev
```
npm --prefix cornell-degree-planner run dev
```

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
```

A **live** `roster-sync` rewrites the whole course catalog — treat it as a
beta-gate decision, not routine.

## Historical

SQL migrations under `supabase/migrations/` are historical source data only —
Firestore (seeded from the derived JSON) is canonical. The Supabase backend is
gone; never point deploy or runtime at it.
