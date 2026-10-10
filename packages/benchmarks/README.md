# @atlasguard/benchmarks

* `datasets/` — official benchmark datasets (format v1). `nigerian-context-v1.json`: 57
  cases, all **pending review** (AI-assisted drafts; see `docs/benchmarking.md`).
* `schemas/benchmark-dataset.schema.json` — JSON Schema generated from the Zod schema in
  `@atlasguard/shared` (`pnpm --filter @atlasguard/benchmarks schema`).
* `fixtures/` — **SIMULATED** hand-written responses used only by the development fixture
  provider and tests. They are not model output.
* `scripts/validate.ts` — `pnpm benchmarks:validate [file.json …]` prints structure errors,
  quality warnings and review statistics.

Tests (`pnpm --filter @atlasguard/benchmarks test`) check dataset integrity, that no case is
marked verified without reviewer metadata, and that the fixtures evaluate to their designed
verdicts (including the cross-language contradiction in the transfer group).
