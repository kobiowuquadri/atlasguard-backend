# AtlasGuard REST API

* Base path: `/api/v1`
* Interactive docs: `/api/docs` (Swagger UI) · machine-readable: `/api/docs-json` · snapshot:
  [openapi.json](openapi.json)
* Authentication: `Authorization: Bearer ag_…` (API key, for SDK/CI) or the dashboard session
  cookie. API keys are created in the dashboard (*Developer API*) and can be restricted to
  one project.

## Envelope and errors

```json
{ "success": true, "data": { … }, "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
{ "success": false, "error": { "code": "MODEL_PROVIDER_UNAVAILABLE", "message": "…", "requestId": "4f0c…" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400/422 | invalid input (`details` lists problems) |
| `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | 401 | missing/invalid session or key / wrong email or password |
| `FORBIDDEN` | 403 | not allowed (e.g. API key managing keys, cross-site request) |
| `NOT_FOUND` | 404 | unknown **or not yours** |
| `CONFLICT` | 409 | duplicate (email, suite version), invalid state |
| `RATE_LIMITED` | 429 | slow down |
| `MODEL_PROVIDER_NOT_CONFIGURED` / `MODEL_PROVIDER_UNAVAILABLE` | 503 | no N-ATLaS endpoint / endpoint unreachable — AtlasGuard does not fall back to another model |
| `UNSUPPORTED_MODEL_CONFIGURATION` | 422 | configuration not available or language not supported |
| `EVIDENCE_EXPORT_DISABLED` | 403 | evidence requested for a simulated run |
| `RUN_NOT_CANCELLABLE` / `INCOMPATIBLE_RUNS` | 409 / 422 | run already finished / runs of different suites |
| `INTERNAL_ERROR` | 500 | unexpected (quote the `requestId`) |

Every response carries `x-request-id` (an incoming well-formed `x-request-id` is reused).

## Endpoints

| Method & path | Description |
|---|---|
| `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | Account and session (cookie). `me` works with API keys too. |
| `PATCH /users/me` · `POST /users/me/onboarding-complete` | Profile (session only) |
| `POST /projects` · `GET /projects` · `GET /projects/:id` · `PATCH /projects/:id` · `DELETE /projects/:id` | Projects; delete archives and keeps history |
| `GET /benchmarks` · `GET /benchmarks/:id` · `GET /benchmarks/:id/cases` | Suites (filters: `search`, `language`, `category`) and cases (`language`, `category`, `reviewStatus`, `semanticGroupId`, `search`) |
| `POST /benchmarks` · `POST /benchmarks/import` | Create a private suite from a dataset · import with `dryRun` validation |
| `GET /benchmarks/:id/export` | Download an importable dataset |
| `PATCH /benchmarks/:id/cases/:caseId/review` | Content review (`VERIFIED` needs `attestation: true`) |
| `GET /model/status` · `GET /model-configurations` | N-ATLaS endpoint health and provenance · usable configurations |
| `POST /evaluations/runs` · `GET /evaluations/runs` · `GET /evaluations/runs/:id` | Queue a run · list (`projectId`, `status`, `suiteId`) · details with progress |
| `GET /evaluations/runs/:id/results` · `GET …/results/:resultId` | Per-case results (`language`, `verdict`, `category`, `search`) |
| `POST …/results/:resultId/reviews` | Human decision `{ decision: PASSED|FAILED, notes }` |
| `GET /evaluations/runs/:id/consistency` | Cross-language analysis with side-by-side entries |
| `POST /evaluations/runs/:id/cancel` · `POST /evaluations/runs/:id/rerun` | Cancel · repeat with identical settings |
| `GET /reports/:runId` · `GET /reports/:runId/export?format=json|csv|markdown` | Structured report · file download |
| `GET /reports/compare?baseRunId=&targetRunId=` | Compare two runs of the same suite |
| `GET /reports/:runId/evidence` | N-ATLaS integration evidence (completed, non-simulated runs) |
| `GET /insights/overview` · `GET /insights/languages` | Dashboard metrics (`includeSimulated`, `projectId`, `runId`) |
| `POST /api-keys` · `GET /api-keys` · `DELETE /api-keys/:id` | API keys (session only) |
| `POST /feedback` · `GET /feedback` · `GET /feedback/export` | Beta feedback (submit with consent · admin list · admin export) |
| `GET /health` · `GET /ready` | Liveness · readiness (database) |

### Creating a run

```bash
curl -X POST "$BASE/evaluations/runs" -H "Authorization: Bearer $ATLASGUARD_API_KEY" -H "Content-Type: application/json" -d '{
  "projectId": "…",
  "suiteId": "…",
  "languages": ["en-NG", "yo", "ha", "ig"],
  "categories": ["financial_terminology"],
  "parameters": { "temperature": 0.1, "maxTokens": 512, "repetitionPenalty": 1.12 }
}'
```

`modelConfigurationId` defaults to the server's N-ATLaS configuration. If the endpoint is
unreachable the request fails with `MODEL_PROVIDER_UNAVAILABLE` — nothing is queued. Cases run
asynchronously; poll `GET /evaluations/runs/:id` until `status` is `COMPLETED`, `FAILED` or
`CANCELLED` (the SDK's `waitForCompletion` does this).

More examples: [`packages/sdk/examples`](../packages/sdk/examples) (TypeScript, JavaScript,
curl) and the *Developer API* page of the dashboard, which fills in your host's base URL.
