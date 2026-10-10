# Deployment

Three pieces, deployed separately:

| Piece | Recommended host | Notes |
|---|---|---|
| PostgreSQL | Neon, Render PostgreSQL, Supabase, any managed PostgreSQL 15+ | Must be UTF-8 (the default on these hosts) |
| API (this repository) | Render, Railway, Fly.io or a VPS | Node.js 24; one instance is enough for the MVP; more instances share the queue safely |
| Dashboard ([atlasguard-frontend](https://github.com/kobiowuquadri/atlasguard-frontend)) | Vercel | Proxies `/api/*` to the API |
| N-ATLaS inference | GPU host (Kaggle notebook for demos; RunPod/Lambda/cloud GPU or HF Inference Endpoints for stable hosting) | See [natlas-integration.md](natlas-integration.md) |

Do not deploy the 8B model on the API host — it needs a GPU with ≈ 16 GB of memory.

## 1. Database

Create a database and copy its connection string (with `sslmode=require` for most managed
hosts), e.g. `postgresql://user:pass@host/atlasguard?sslmode=require`.

## 2. API

### Render (Node runtime, no Docker)

`render.yaml` in the repository root describes the service. Or configure manually:

* **Root directory:** the repository root
* **Build command:**
  `corepack enable && pnpm install --frozen-lockfile && pnpm build:packages && pnpm --filter @atlasguard/api exec prisma generate && pnpm --filter @atlasguard/api build`
* **Start command:** `cd apps/api && npx prisma migrate deploy && node dist/main.js`
* **Health check path:** `/api/v1/health`

### Docker (any container host)

```bash
docker build -f apps/api/Dockerfile -t atlasguard-api .
docker run -p 4000:4000 --env-file apps/api/.env.production atlasguard-api
```

(The image runs `prisma migrate deploy` before starting.)

### Environment (production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | managed PostgreSQL URL |
| `APP_ORIGINS` | the dashboard origin, e.g. `https://atlasguard.vercel.app` |
| `TRUST_PROXY` | `true` |
| `API_KEY_PEPPER` | 32+ random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `ADMIN_EMAILS` | your administrator email(s) |
| `NATLAS_BASE_URL`, `NATLAS_API_KEY` | from the inference endpoint |
| `NATLAS_MODEL_REVISION` | the served commit (optional when using AtlasGuard's inference service) |

Fixtures cannot be enabled in production. Cookies are `Secure` automatically.

## 3. Dashboard (Vercel)

1. Import the [atlasguard-frontend](https://github.com/kobiowuquadri/atlasguard-frontend) repository as a Next.js project.
2. Environment variables: `ATLASGUARD_API_URL=https://<your-api-host>` and
   `SESSION_COOKIE_NAME=ag_session` (must match the API).
3. Deploy, then put the Vercel URL in the API's `APP_ORIGINS` and redeploy the API.

The dashboard proxies `/api/*` (including `/api/docs`) to the API, so browsers only ever talk
to the dashboard origin and the session cookie is first-party.

## 4. Post-deploy checklist

- [ ] `GET https://<dashboard>/api/v1/health` returns `ok`; `/api/v1/ready` returns `ready`
- [ ] `GET /api/v1/model/status` shows N-ATLaS `available` with served model `NCAIR1/N-ATLaS`
- [ ] sign up, create a project, run a small evaluation with the N-ATLaS configuration
- [ ] export the integration evidence and store it in `evidence/integration/`
- [ ] the development-mode banner is **not** shown (fixtures disabled)
- [ ] share the dashboard URL and [beta-testing.md](beta-testing.md) with testers
