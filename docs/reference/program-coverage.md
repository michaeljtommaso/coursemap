# Program Coverage Report

STATUS: PLACEHOLDER — not yet generated from a real catalog run.

This file is produced by `scripts/validate-programs.ts` (spec 011 §2a, the
authoring pipeline's validation harness, Unit 11B). It has **not** been run
against live data yet — no `GOOGLE_APPLICATION_CREDENTIALS` is assumed to
exist in this environment, and the harness is deliberately never invoked
against live Firestore without them.

Once credentials are available, regenerate the real report with:

```
GOOGLE_APPLICATION_CREDENTIALS=<path to service-account key> npx tsx validate-programs.ts
```

(run from the `scripts/` folder). This will overwrite this file with one
section per authored major: seat/pool counts, per-requirement candidate
counts (bottom-5 scarcest listed), errors/warnings/info, and a
generated-by line naming the data source used.

Offline/CI verification of the harness itself — including a full
end-to-end run against the real `scripts/seed-data` corpus with a fixture
catalog via `--dump` — lives in `scripts/validate-programs.corpus.ts`
(`npx tsx validate-programs.corpus.ts`), which writes its own reports to a
temp path rather than here.
