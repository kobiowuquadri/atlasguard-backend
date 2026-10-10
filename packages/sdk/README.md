# @atlasguard/sdk

Typed TypeScript client for the AtlasGuard API — run multilingual N-ATLaS evaluations
(Nigerian English, Yoruba, Hausa, Igbo) from scripts and CI. Zero runtime dependencies.

> Not published to npm yet. Install it from this repository (below).

## Install

```bash
git clone https://github.com/kobiowuquadri/atlasguard-backend.git && cd atlasguard-backend
pnpm install
pnpm --filter @atlasguard/sdk build
cd packages/sdk && npm pack              # → atlasguard-sdk-0.1.0.tgz
cd /your/project && npm install /path/to/atlasguard-sdk-0.1.0.tgz
```

Supported runtimes: Node.js 18+ (global `fetch`) and modern browsers. ESM and CommonJS
builds with type declarations. Keep API keys server-side.

## Initialise and authenticate

Create an API key in the dashboard (*Developer API → Create key*; restricting it to one
project is recommended).

```ts
import { AtlasGuard } from '@atlasguard/sdk';

const atlas = new AtlasGuard({
  baseUrl: process.env.ATLASGUARD_BASE_URL!, // e.g. https://your-host (the /api/v1 suffix is added)
  apiKey: process.env.ATLASGUARD_API_KEY!,
  timeoutMs: 30_000, // optional
});
```

## Benchmarks

```ts
const { items: suites } = await atlas.benchmarks.list();
const cases = await atlas.benchmarks.cases(suites[0].id, { language: 'yo' });
for await (const c of atlas.benchmarks.allCases(suites[0].id)) console.log(c.key);
```

## Run an evaluation and wait for it

```ts
const run = await atlas.evaluations.run({
  projectId: 'YOUR_PROJECT_ID',
  suiteId: 'nigerian-context-v1', // id or slug
  languages: ['en-NG', 'yo'],
  parameters: { temperature: 0.1, maxTokens: 512 },
});

const finished = await atlas.evaluations.waitForCompletion(run.id, {
  intervalMs: 3000,
  onProgress: (r) => console.log(`${r.status} ${r.progress?.done}/${r.totalCases}`),
});
console.log(finished.summary?.overall.verifiedPassRate, finished.isSimulated);
```

## Results, consistency and reports

```ts
const page = await atlas.evaluations.results(run.id, { verdict: 'FAILED' });
for await (const r of atlas.evaluations.allResults(run.id)) console.log(r.caseKey, r.finalVerdict);

const groups = await atlas.evaluations.consistency(run.id);
const inconsistent = groups.filter((g) => g.verdict === 'INCONSISTENT');

const csv = await atlas.reports.export(run.id, 'csv');        // or 'json' | 'markdown'
const comparison = await atlas.reports.compare(baseRunId, run.id);
const evidence = await atlas.reports.evidence(run.id);         // real (non-simulated) runs only
```

Other calls: `projects.list/get/create/update/archive`, `evaluations.list/get/result/cancel/rerun/review`,
`benchmarks.get/import/export`, `system.health/modelStatus/modelConfigurations`.

## Errors

```ts
import { AtlasGuardApiError, AtlasGuardNetworkError, AtlasGuardTimeoutError } from '@atlasguard/sdk';

try {
  await atlas.evaluations.run({ projectId, suiteId: 'nigerian-context-v1', languages: ['ha'] });
} catch (error) {
  if (error instanceof AtlasGuardApiError) {
    // e.g. MODEL_PROVIDER_UNAVAILABLE (503): N-ATLaS endpoint down — AtlasGuard never substitutes another model
    console.error(error.status, error.code, error.message, error.requestId);
  } else if (error instanceof AtlasGuardTimeoutError || error instanceof AtlasGuardNetworkError) {
    console.error('AtlasGuard unreachable', error.message);
  }
}
```

Idempotent requests (GET) are retried up to `maxRetries` (default 2) on network errors, 429
and 5xx; POST/PATCH/DELETE are never retried automatically. Every method accepts an optional
`AbortSignal`.

## Examples and tests

* [`examples/run-evaluation.ts`](examples/run-evaluation.ts), [`examples/run-evaluation.mjs`](examples/run-evaluation.mjs), [`examples/curl.sh`](examples/curl.sh)
* `pnpm --filter @atlasguard/sdk test` — mocked tests; set `ATLASGUARD_TEST_BASE_URL`,
  `ATLASGUARD_TEST_API_KEY`, `ATLASGUARD_TEST_PROJECT_ID` (and `ATLASGUARD_TEST_SIMULATED=1`
  for fixture runs) to also run the live end-to-end test.
