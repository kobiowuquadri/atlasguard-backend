# AtlasGuard API reference (v1)

AtlasGuard's REST API is what the dashboard and the TypeScript SDK use: every screen is
built on the endpoints below, so anything you can do in the dashboard you can script.

| | |
|---|---|
| Base path | `/api/v1` |
| Local | `http://localhost:4000/api/v1` (or through the dashboard proxy: `http://localhost:3000/api/v1`) |
| Deployed | `https://<dashboard-host>/api/v1` (Vercel proxies to the API) or `https://<api-host>/api/v1` |
| Interactive docs | `/api/docs` (Swagger UI) · OpenAPI 3 JSON at `/api/docs-json` · snapshot in [openapi.json](openapi.json) |
| SDK | [`packages/sdk`](../packages/sdk/README.md) (`@atlasguard/sdk`) |

---

## 1. Quick start

```bash
BASE=http://localhost:4000/api/v1
KEY=ag_…            # Dashboard → Developer API → Create key (shown once)
AUTH="Authorization: Bearer $KEY"

# 1. Is N-ATLaS reachable? (public)
curl -s "$BASE/model/status"

# 2. Find the benchmark suite and your project
curl -s "$BASE/benchmarks" -H "$AUTH"
curl -s "$BASE/projects" -H "$AUTH"

# 3. Queue a run (cases execute asynchronously)
curl -s -X POST "$BASE/evaluations/runs" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"projectId":"<project-id>","suiteId":"<suite-id>","languages":["en-NG","yo","ha","ig"]}'

# 4. Poll until status is COMPLETED, FAILED or CANCELLED
curl -s "$BASE/evaluations/runs/<run-id>" -H "$AUTH"

# 5. Read results, the cross-language analysis and the report
curl -s "$BASE/evaluations/runs/<run-id>/results?verdict=FAILED" -H "$AUTH"
curl -s "$BASE/evaluations/runs/<run-id>/consistency" -H "$AUTH"
curl -s "$BASE/reports/<run-id>/export?format=csv" -H "$AUTH" -o results.csv
```

---

## 2. Authentication

| Method | How | Used by |
|---|---|---|
| Session cookie | `POST /auth/login` or `/auth/register` sets an HTTP-only cookie (`ag_session`, 7 days) | The dashboard |
| API key | `Authorization: Bearer ag_…` **or** `X-API-Key: ag_…` | SDK, scripts, CI |

* **API keys** are created in the dashboard (*Developer API → Create key*) or with
  `POST /api-keys` from a session. The plaintext key is returned **once**; AtlasGuard stores
  only a peppered hash. A key can be restricted to one project — it then sees only that
  project (anything else answers `404`). Archiving a project revokes its keys.
* **Session-only endpoints** (API keys get `403`): `/users/me/*`, `/api-keys/*`, `/feedback/*`.
* **Administrator-only**: `GET /feedback`, `GET /feedback/export`, importing a suite as
  *official*, and reviewing official benchmark content. Accounts whose email is in the API's
  `ADMIN_EMAILS` are administrators.
* **Public** (no credentials): `GET /health`, `GET /ready`, `GET /model/status`,
  `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`.
* **Cross-site protection**: a cookie-authenticated `POST`/`PATCH`/`DELETE` must come from an
  origin listed in the API's `APP_ORIGINS`; otherwise `403 "Cross-site request blocked."`.
  API-key requests are not affected.

---

## 3. Conventions

### Response envelope

```json
{ "success": true, "data": { … } }
{ "success": true, "data": [ … ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "requestId": "4f0c…", "details": [ … ] } }
```

File downloads (`…/export`) return the file itself, not the envelope.

### Pagination

List endpoints accept `page` (1-based, default 1) and `pageSize` (1–100, default 20) and return
`meta`. The SDK's `allCases` / `allResults` iterate pages for you.

### Errors

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 422 | Invalid input; `details` lists each problem |
| `UNAUTHENTICATED` | 401 | Missing or expired session, or an invalid/revoked API key |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `FORBIDDEN` | 403 | Not allowed (session-only endpoint with a key, non-admin, cross-site request) |
| `NOT_FOUND` | 404 | Unknown **or not yours** (resources of other users are never revealed) |
| `CONFLICT` | 409 | Duplicate (email, suite version) or invalid state (e.g. evidence for an unfinished run) |
| `RUN_NOT_CANCELLABLE` | 409 | The run has already finished |
| `INCOMPATIBLE_RUNS` | 422 | Compared runs use different benchmark suites |
| `UNSUPPORTED_MODEL_CONFIGURATION` | 422 | Configuration unavailable or a language it does not support |
| `EVIDENCE_EXPORT_DISABLED` | 403 | Evidence requested for a simulated run |
| `RATE_LIMITED` | 429 | Too many requests (see below) |
| `MODEL_PROVIDER_NOT_CONFIGURED` | 503 | No N-ATLaS endpoint is configured on the server |
| `MODEL_PROVIDER_UNAVAILABLE` | 503 | The N-ATLaS endpoint is unreachable — **AtlasGuard never falls back to another model**; nothing is queued |
| `INTERNAL_ERROR` | 500 | Unexpected; quote the `requestId` when reporting it |

### Request ids

Every response has an `x-request-id` header (a well-formed incoming `x-request-id` is reused),
and error bodies repeat it. The same id is stored on evaluation results.

### Rate limits

| Scope | Limit |
|---|---|
| Every endpoint (per client IP) | 300 requests / minute |
| `POST /auth/register` | 5 / minute |
| `POST /auth/login` | 10 / minute |
| `POST /evaluations/runs`, `POST /evaluations/runs/:id/rerun` | 20 / minute |
| `POST /feedback` | 5 / minute |

### Data formats and enumerations

* Ids are UUIDs; timestamps are ISO 8601 in UTC.
* **Languages**: `en-NG` (Nigerian English), `yo` (Yoruba), `ha` (Hausa), `ig` (Igbo).
* **Categories**: `financial_terminology`, `nigerian_english`, `education`, `civic_information`,
  `cultural_context`, `translation_meaning`.
* **Run status**: `QUEUED` → `RUNNING` → `COMPLETED` | `FAILED` | `CANCELLED`.
* **Verdicts** (per case): `PASSED`, `FAILED` (a deterministic check failed), `NEEDS_REVIEW`
  (nothing failed but something could not be decided automatically), `ERROR` (technical failure —
  never counted as a model failure), `SKIPPED` (not executed, e.g. the run was cancelled).
  `finalVerdict` is the human decision when a reviewer has recorded one, otherwise `verdict`.
* **Verified pass rate** = PASSED ÷ (PASSED + FAILED). Needs-review, errors and skipped cases are
  excluded and reported separately; the rate is `null` when nothing was decided.
* **Content review status** (benchmark cases): `DRAFT`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`.
* **Fact status**: `supported`, `contradicted`, `not_found`, `uncertain`.
* **Consistency verdict** (per semantic group): `CONSISTENT`, `INCONSISTENT`, `NEEDS_REVIEW`,
  `INSUFFICIENT_DATA`.

---

## 4. Endpoints

Auth column: **Public** · **Any** (session or API key) · **Session** (dashboard session only) · **Admin**.

### System

| Method & path | Auth | Description |
|---|---|---|
| `GET /health` | Public | Liveness: `{ status: "ok", service, version, evaluatorVersion, uptimeSeconds }` |
| `GET /ready` | Public | Readiness (database reachable): `{ status: "ready", database: "ok" }` or `503` |
| `GET /model/status` | Public | Live N-ATLaS endpoint health and provenance; `?refresh=true` bypasses the short health cache |
| `GET /model-configurations` | Any | Model configurations usable for runs, each with `availability` (`available` / `unavailable` / `not_configured`) |

`GET /model/status` response:

```json
{
  "natlas": {
    "configured": true,
    "health": { "status": "available", "checkedAt": "2026-10-10T09:35:06.232Z", "latencyMs": 1551,
                "simulated": false, "message": "N-ATLaS endpoint is reachable." },
    "model": { "providerType": "NATLAS", "modelIdentifier": "NCAIR1/N-ATLaS", "servedModel": "NCAIR1/N-ATLaS",
               "revision": "e294476928aca9030e924ca27bb8e085e8581273", "dtype": "float16", "quantization": "none",
               "device": "cuda x2 (Tesla T4)", "runtime": "transformers 4.57.6; torch 2.11.0+cu128",
               "contextLength": 131072, "simulated": false, "reportedBy": "provider" }
  },
  "fixtures": { "enabled": false },
  "attribution": "N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital Economy, and powered by Awarri Technologies."
}
```

`model.reportedBy` is `provider` when the endpoint itself reported these details and
`configuration` when they come from server settings (endpoint unreachable). `fixtures.enabled`
is always `false` in production.

### Authentication and profile

| Method & path | Auth | Body | Returns |
|---|---|---|---|
| `POST /auth/register` | Public | `{ name (2–100), email, password (8–128) }` | `201 { user }` + session cookie |
| `POST /auth/login` | Public | `{ email, password }` | `200 { user }` + session cookie · `401 INVALID_CREDENTIALS` |
| `POST /auth/logout` | Public | — | `{ loggedOut: true }`, clears the cookie |
| `GET /auth/me` | Any | — | `{ user, authMethod: "session" \| "api_key", apiKeyProjectId }` |
| `PATCH /users/me` | Session | `{ name (2–100) }` | `{ user }` |
| `POST /users/me/onboarding-complete` | Session | — | `{ user }` with `onboardedAt` set |

`user`: `{ id, name, email, role: "DEVELOPER" | "ADMIN", onboardedAt, createdAt }`.

### Projects

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `POST /projects` | Any | body `{ name (2–100), description? (≤1000) }` | `201` project |
| `GET /projects` | Any | `search?`, `page`, `pageSize` | Page of projects, each with `runCount` and `latestRun` |
| `GET /projects/:id` | Any | — | Project with `recentRuns` and `evaluationSummary { totalRuns, runsByStatus, lastCompletedRun }` |
| `PATCH /projects/:id` | Any | body `{ name?, description? }` | Project |
| `DELETE /projects/:id` | Any | — | `{ id, archived: true }` — history is kept, project API keys are revoked |

### Benchmarks

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `GET /benchmarks` | Any | `search?` (name or slug), `language?`, `category?`, `page`, `pageSize` | Page of suites you can use (official, public and your own), each with `stats` |
| `GET /benchmarks/:id` | Any | — | Suite with `stats` and `semanticGroups` (shared reference facts per group) |
| `GET /benchmarks/:id/cases` | Any | `language?`, `category?`, `reviewStatus?`, `semanticGroupId?`, `search?`, `page`, `pageSize` | Page of cases: prompt, reference facts, rules, provenance, review status |
| `GET /benchmarks/:id/export` | Any | — | File: importable dataset JSON (`<slug>-v<version>.json`) |
| `POST /benchmarks/import` | Any | body `{ dataset, dryRun?, official? }` | `{ valid, saved, warnings[], counts { semanticGroups, cases }, suite?, contentHash? }` |
| `POST /benchmarks` | Any | body: the dataset itself | Same as import without `dryRun` |
| `PATCH /benchmarks/:id/cases/:caseId/review` | Any* | body `{ status: "VERIFIED" \| "REJECTED" \| "PENDING_REVIEW", notes? (≤2000), attestation? }` | Updated case |

* `dryRun: true` validates without saving — use it first. `official: true` requires an
  administrator. The dataset format is defined in
  [`packages/benchmarks/schemas/benchmark-dataset.schema.json`](../packages/benchmarks/schemas).
* \*Reviews: you can review your own suites; official content only as an administrator.
  `VERIFIED` requires `attestation: true` (the reviewer confirms fluency in the case
  language). Reviewer and time are recorded.
* `stats`: `{ caseCount, semanticGroupCount, languages { code: count }, categories { code: count }, reviewStatus, verifiedCount, unreviewedCount }`.

### Evaluations

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `POST /evaluations/runs` | Any | body: see below | `201` run (`QUEUED`) |
| `GET /evaluations/runs` | Any | `projectId?`, `status?`, `suiteId?`, `page`, `pageSize` | Page of runs, newest first |
| `GET /evaluations/runs/:id` | Any | — | Run with `progress { total, pending, running, done, byVerdict }` |
| `GET /evaluations/runs/:id/results` | Any | `language?`, `verdict?`, `category?`, `search?` (prompt/response), `page`, `pageSize` | Page of per-case results |
| `GET /evaluations/runs/:id/results/:resultId` | Any | — | One result with full checks and `reviews[]` |
| `POST /evaluations/runs/:id/results/:resultId/reviews` | Any | body `{ decision: "PASSED" \| "FAILED", notes? (≤2000) }` | Updated result; the decision becomes `finalVerdict` |
| `GET /evaluations/runs/:id/consistency` | Any | — | Cross-language analysis per semantic group (completed runs) |
| `POST /evaluations/runs/:id/cancel` | Any | — | Run; in-flight cases finish, the rest are `SKIPPED` · `409 RUN_NOT_CANCELLABLE` |
| `POST /evaluations/runs/:id/rerun` | Any | — | `201` new run with identical suite, languages, filters and parameters |

**Create-run body**

| Field | Type | Notes |
|---|---|---|
| `projectId` | uuid | Required |
| `suiteId` | uuid | Required |
| `languages` | string[] | Required, ≥ 1 of `en-NG`, `yo`, `ha`, `ig` |
| `categories` | string[] | Optional filter |
| `caseIds` | uuid[] | Optional: run only these cases (1–1000) |
| `onlyVerified` | boolean | Only cases verified by a fluent reviewer |
| `modelConfigurationId` | uuid | Defaults to the server's N-ATLaS configuration |
| `parameters.temperature` | number 0–2 | Default 0.1 (N-ATLaS model card) |
| `parameters.maxTokens` | int 16–2048 | Default 512 |
| `parameters.topP` | number 0.05–1 | Optional |
| `parameters.repetitionPenalty` | number 1–2 | Default 1.12 (model card) |
| `parameters.seed` | int ≥ 0 | Optional, for sampling reproducibility |
| `parameters.systemPrompt` | string ≤ 2000 | Default: the model card prompt; `""` sends none |

If the N-ATLaS endpoint is not configured or unreachable the request fails with `503` and
nothing is queued. Each run records the benchmark version and content hash, a snapshot of every
case, the model identifier and revision, the generation parameters and the evaluator version.

**Run** (abridged): `{ id, status, isSimulated, project { id, name }, suite { id, slug, name,
version, isOfficial }, modelIdentifier, modelRevision, providerType, inferenceConfig,
evaluatorVersion, languages, selection, totalCases, completedCases, summary, providerMetadata
{ modelInfo, health }, errorDetails, queuedAt, startedAt, completedAt, createdBy }`.

`summary`: `{ overall, byLanguage { code: bucket }, byCategory, byLanguageCategory, consistency
{ groups, byVerdict, confirmedContradictions }, humanReviewed, computedAt }`, where a bucket is
`{ total, passed, failed, needsReview, skipped, errors, pending, determinate, verifiedPassRate,
averageLatencyMs, medianLatencyMs }`.

**Result** (per case): `{ id, caseKey, language, category, prompt, response, caseSnapshot,
executionStatus, verdict, finalVerdict, checks[], factChecks[], languageDetection,
responseTimeMs, providerInferenceMs, requestId, responseMetadata { servedModel, finishReason,
usage, simulated }, errorDetails, executedAt }`.

* `checks[]`: `{ id, dimension, status: pass | fail | uncertain | not_applicable, method,
  explanation, evidence?, requiresHumanReview }` with dimensions `response_validity`,
  `language_compliance`, `factual_accuracy`, `instruction_compliance`, `latency`.
* `factChecks[]`: `{ factId, factType: numeric | entity | concept, required, status, method,
  evidence?, assertedValues? }`.
* `responseTimeMs` is the full round trip measured by AtlasGuard; `providerInferenceMs` is the
  generation time reported by the endpoint.

**Consistency group**: `{ semanticGroupKey, title, category, languagesCompared,
languagesMissing, verdict, summary { sharedFactsChecked, confirmedContradictions, missingFacts,
uncertainFindings, consistentFacts }, findings[], expectedFacts[], entries[] }`.

* `findings[]`: `{ type, severity: conflict | omission | review | info, factId?, languages[],
  message, values? { lang: [values] }, statuses? }`. Types: `numeric_conflict` and
  `entity_conflict` (languages stated different values — a confirmed contradiction),
  `possible_contradiction` and `uncertain_fact` (routed to review), `fact_omission`,
  `missing_response`, `consistent_fact`.
* `entries[]`: one per language — prompt, response, verdicts and that language's fact checks,
  for side-by-side display.

### Reports

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `GET /reports/:runId` | Any | — | Structured report: overview, summary, language and category performance, consistency, methodology, limitations, attribution |
| `GET /reports/:runId/export` | Any | `format=json \| csv \| markdown` (default `json`) | File `atlasguard-run-<id8>[-SIMULATED].<ext>`; CSV has one row per case |
| `GET /reports/compare` | Any | `baseRunId`, `targetRunId` (same suite) | Deltas by language and category, verdict changes, warnings when settings differ |
| `GET /reports/:runId/evidence` | Any | — | N-ATLaS integration evidence bundle (completed, non-simulated runs only) |

Simulated runs are labelled in every report and export (`-SIMULATED` file names, a notice in
the content) and are refused by the evidence endpoint (`403 EVIDENCE_EXPORT_DISABLED`;
unfinished runs answer `409 CONFLICT`).

**Evidence bundle** (`kind: "atlasguard.natlas-integration-evidence"`, `formatVersion: 1`):
`run` (provenance: model, revision, provider metadata, parameters, benchmark hash),
`statistics` (`cases`, `responses`, `errors`, `servedModels`), `interactions[]` (one per case:
`caseKey, language, requestId, providerRequestId, servedModel, startedAt, completedAt,
finishReason, usage, latencyMs, providerInferenceMs, prompt, response, verdict, error`),
`attribution` and `integrity { algorithm: "sha256", canonicalisation: "sorted-keys JSON",
digest }`. To verify: SHA-256 over the bundle **without** `integrity`, serialised as JSON with
object keys sorted recursively and no whitespace.

### Insights

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `GET /insights/overview` | Any | `projectId?`, `runId?`, `includeSimulated?` (default `false`) | Totals, verdict distribution, per-language comparison, 14-day activity, recent runs, model status |
| `GET /insights/languages` | Any | same | Per-language stats and categories; languages with no completed cases are reported as `evaluated: false`, never as 0% |

### API keys

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `POST /api-keys` | Session | body `{ name (2–80), projectId? }` | `{ apiKey, key }` — `key` is the plaintext secret, shown only in this response |
| `GET /api-keys` | Session | — | Your keys (prefix, project, last used, revoked) — never the secret |
| `DELETE /api-keys/:id` | Session | — | `{ id, revoked: true }` |

### Beta feedback

| Method & path | Auth | Parameters | Returns |
|---|---|---|---|
| `POST /feedback` | Session | body: see below | `{ id, createdAt }` |
| `GET /feedback` | Admin | — | All feedback, newest first |
| `GET /feedback/export` | Admin | — | File: consented feedback as JSON |

Body: `testerIdentifier` (2–100, name or agreed pseudonym), `developerBackground?` (≤300),
`testedFeatures` (string[] ≤ 20), `easeOfUseRating?` (1–5), `mostUsefulFeature?` (≤500),
`problemsEncountered?` (≤4000), `suggestions?` (≤4000), `overallAssessment` (5–4000) and
`consentRecorded: true` (required).

---

## 5. SDK equivalents

```ts
import { AtlasGuard } from '@atlasguard/sdk';
const atlas = new AtlasGuard({ baseUrl: process.env.ATLASGUARD_BASE_URL!, apiKey: process.env.ATLASGUARD_API_KEY! });
```

| SDK | Endpoint |
|---|---|
| `atlas.system.health()` · `modelStatus()` · `modelConfigurations()` | `GET /health` · `GET /model/status` · `GET /model-configurations` |
| `atlas.projects.list/get/create/update/archive` | `/projects` |
| `atlas.benchmarks.list/get/cases/allCases/import/export` (`resolveId` accepts a slug) | `/benchmarks` |
| `atlas.evaluations.run(input)` · `get(id)` · `waitForCompletion(id, { intervalMs, onProgress })` | `POST /evaluations/runs` · `GET /evaluations/runs/:id` (polled) |
| `atlas.evaluations.list/results/allResults/result/review/consistency/cancel/rerun` | `/evaluations/runs/…` |
| `atlas.reports.get/export(id, 'json' \| 'csv' \| 'markdown')/compare/evidence` | `/reports/…` |

API errors are thrown as `AtlasGuardApiError` (`status`, `code`, `details`, `requestId`); timeouts and
unreachable hosts as `AtlasGuardTimeoutError` / `AtlasGuardNetworkError` — all extend `AtlasGuardError`. More
examples: [`packages/sdk/examples`](../packages/sdk/examples) and the dashboard's *Developer API*
page, which fills in your host's base URL.
