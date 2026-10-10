# Local setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22.12 (24 recommended) | `node --version` |
| pnpm | 10.x | `npm i -g pnpm@10` (or `corepack enable`) |
| PostgreSQL | 15+ with **UTF-8** | optional — `pnpm db:start` runs PostgreSQL 17 for you |
| Python | 3.10+ | only for the inference service and its tests |

Docker is optional (see `docker-compose.yml`). A GPU is only needed to run N-ATLaS itself.

## 1. API and packages

```bash
git clone https://github.com/kobiowuquadri/atlasguard-backend.git
cd atlasguard-backend
pnpm install
pnpm db:start            # leave running; creates UTF-8 databases atlasguard + atlasguard_test on :54329
cp apps/api/.env.example apps/api/.env
pnpm build:packages
pnpm db:migrate          # prisma migrate dev
pnpm dev:api             # http://localhost:4000, Swagger at /api/docs
```

On first start the API imports the official benchmark suite and synchronises the model
configurations from the environment.

**Using your own PostgreSQL** — create a UTF-8 database and set `DATABASE_URL`:

```sql
CREATE DATABASE atlasguard ENCODING 'UTF8' TEMPLATE template0;
```

With Docker: `docker compose up -d postgres` and
`DATABASE_URL=postgresql://atlasguard:atlasguard@localhost:5432/atlasguard`.

## 2. Dashboard

```bash
git clone https://github.com/kobiowuquadri/atlasguard-frontend.git
cd atlasguard-frontend
pnpm install
cp .env.example .env.local      # ATLASGUARD_API_URL=http://localhost:4000
pnpm dev                        # http://localhost:3000
```

`APP_ORIGINS` on the API must contain the dashboard origin (`http://localhost:3000` by
default). Accounts whose email is in `ADMIN_EMAILS` become administrators (needed to review
official benchmark content and export beta feedback).

## 3. N-ATLaS

Follow [natlas-integration.md](natlas-integration.md), then set `NATLAS_BASE_URL` and
`NATLAS_API_KEY` in `apps/api/.env` and restart the API. Check with `pnpm smoke:natlas`.

## Environment reference (`apps/api/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (UTF-8 database) |
| `PORT` | 4000 | HTTP port |
| `APP_ORIGINS` | `http://localhost:3000` | Allowed browser origins (CORS + CSRF allow-list), comma-separated |
| `TRUST_PROXY` | false | Set true behind a load balancer (correct client IPs, secure cookies) |
| `SESSION_COOKIE_NAME` / `SESSION_TTL_HOURS` / `COOKIE_SECURE` | `ag_session` / 168 / production | Session cookie |
| `API_KEY_PEPPER` | dev default | **Required in production** (≥ 32 chars) |
| `ADMIN_EMAILS` | — | Emails promoted to administrator |
| `NATLAS_BASE_URL` / `NATLAS_API_KEY` | — | N-ATLaS inference endpoint and its bearer token |
| `NATLAS_MODEL_ID` / `NATLAS_MODEL_REVISION` | `NCAIR1/N-ATLaS` / — | Model identity recorded on runs (revision is also read from `/model-info`) |
| `NATLAS_ACCEPTED_MODEL_NAMES` | — | Extra served-model names for the same weights |
| `NATLAS_TIMEOUT_MS` / `NATLAS_MAX_RETRIES` / `NATLAS_MAX_CONCURRENCY` | 180000 / 2 / 2 | Provider behaviour; set concurrency to `1` for the AtlasGuard inference service (it generates one response at a time), so latency excludes queueing |
| `ENABLE_FIXTURE_PROVIDER` / `FIXTURE_DELAY_MS` | on outside production / 400 | Simulated fixtures (cannot be enabled in production) |
| `WORKER_ENABLED` / `WORKER_CONCURRENCY` / `WORKER_POLL_INTERVAL_MS` / `WORKER_STALE_AFTER_MS` / `CASE_MAX_ATTEMPTS` | true / 2 / 2000 / 120000 / 3 | Worker |
| `MAX_CASES_PER_RUN` | 500 | Run size limit |
| `AUTO_SEED_BENCHMARKS` / `RATE_LIMIT_ENABLED` / `SWAGGER_ENABLED` / `LOG_LEVEL` | true / true / true / info | Misc |

Dashboard (`.env.local`): `ATLASGUARD_API_URL` (server-side proxy target) and
`SESSION_COOKIE_NAME` (route protection).

## Tests

```bash
pnpm test                                    # all TypeScript suites; API tests start their own PostgreSQL on :54330
TEST_DATABASE_URL=postgresql://… pnpm --filter @atlasguard/api test   # use an existing database instead
cd services/natlas-inference && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt && .venv/Scripts/pytest tests/test_api.py
RUN_TINY_MODEL_TEST=1 pytest tests/test_transformers_backend.py         # needs torch + transformers (CPU is fine)
cd atlasguard-frontend && pnpm build && pnpm start & pnpm test:e2e # Playwright (API with fixtures must be running)
```

## Troubleshooting

* **`character with byte sequence … has no equivalent in encoding "WIN1252"`** — the
  database is not UTF-8. The API refuses to start in this case; recreate the database as
  shown above (`pnpm db:start -- --recreate-non-utf8` does this for the embedded server).
* **Evaluations fail with `MODEL_PROVIDER_NOT_CONFIGURED`** — set `NATLAS_BASE_URL`, or
  explicitly choose the *Development fixtures* configuration for a simulated run.
* **Login works but dashboard actions return 403 "Cross-site request blocked"** — add the
  dashboard origin to `APP_ORIGINS`.
* **Port already in use** — change `PORT` (API), `DEV_DB_PORT` (embedded database) or
  `next dev -p`.
