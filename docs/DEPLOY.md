# Deploying Cornell Degree Planner

> STATUS: NOT BUILT — no hosting chosen yet. When hosting is picked
> (Vercel, Netlify, Firebase, VPS…), replace this stub with exact,
> copy-paste deploy commands and add matching scripts to package.json.
> Rule of thumb from past incidents: deploy commands must name their
> environment explicitly — there is no implicit "current env".

## Local dev
```
npm --prefix cornell-degree-planner run dev
```

## Build
```
npm --prefix cornell-degree-planner run build
```
Build output: `cornell-degree-planner/dist/` (gitignored).

## Supabase
SQL migrations live in `supabase/migrations/` at the repo root. Apply them
in numeric order. Never echo the Supabase service-role key or connection
string into chat, commits, or docs — reference env var names only.
