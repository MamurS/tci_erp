# TCI Analytics Service

FastAPI service for TCI ERP. Two unrelated jobs live here because both need
to run outside the browser:

1. **Credit engine** (`/rating`, `/credit-limit`, `/grade-scale`, `/fx`) —
   no database connection; the frontend fetches statement data from Supabase
   and POSTs it here.
2. **User provisioning** (`/users…`) — creates auth users. This *does* reach
   Supabase, with the service-role key, because the browser must never hold
   that key.

## Run locally

```bash
cd services/analytics
uv sync
uv run uvicorn app.main:app --port 8000
# docs: http://localhost:8000/docs
```

The credit-engine endpoints need no configuration. For provisioning:

```bash
cp .env.example .env      # then paste the service-role key into .env
set -a && . ./.env && set +a
uv run uvicorn app.main:app --port 8000
```

### Security note on the service-role key

`SUPABASE_SERVICE_ROLE_KEY` **bypasses Row Level Security entirely** — it can
read and write every row in the database. It belongs only in this service's
environment.

* Never give it a `VITE_` prefix or put it in `TCI_ERP/.env.local`; anything
  Vite can see ends up in the browser bundle.
* Never commit it. `.env` is git-ignored repo-wide; `.env.example` holds the
  variable names and no values.
* It is never logged, never returned in a response, and never included in an
  error message (`app/supabase_admin.py` truncates upstream error bodies).
* If it is ever exposed, rotate it in the Supabase dashboard
  (Project Settings → API) — rotation is the only remedy.

The endpoints authenticate the **caller** with the caller's own Supabase
access token and load their roles from `tci.user_roles` server-side. A role
claimed in a request body is never trusted; there is no such field.

## Deployment

The service is deployed as a Docker container from this repository. Everything
it needs is committed: `Dockerfile` and `render.yaml` at the **repository
root**, not in this directory — the service imports `credit_engine` as an
editable path dependency, so the build context has to be the repo root or the
build cannot see the library.

### Why Render

| | Render | Railway | Fly.io |
|---|---|---|---|
| Free tier | yes, web services | **none** (usage plan from $5/mo) | trial credit, card required |
| Deploy from GitHub | yes, on push | yes, on push | `flyctl` CLI |
| Secrets | dashboard, encrypted | dashboard | `fly secrets` |
| Blueprint in repo | `render.yaml` | partial | `fly.toml` |

Render wins on the two things that matter here: a real free tier, and
push-to-deploy with no CLI, so redeploying is something anyone on the team can
do. Railway would cost $5/month minimum for a service that is idle most of the
day; Fly needs a local toolchain for what is one small container.

**The cost of the free tier** is that the instance sleeps after ~15 minutes
idle and takes roughly 50–60 seconds to wake. Consequences:

* the Rating tab and the CBU rate lookup already have an unavailable state and
  simply take a moment on the first call — acceptable;
* the **provisioning screens** are the ones that feel it, because an admin
  creating a user waits out the cold start;
* Render's free tier also caps build minutes and bandwidth per month, well
  above what this service uses.

Upgrading *this one service* to Render Starter (**$7/month**) removes the
sleep entirely and changes nothing else. Do that if the wait becomes annoying;
nothing in the code or config has to change — it is a plan setting.

### First deploy (owner)

1. Sign in to <https://render.com> with the GitHub account that owns
   `MamurS/tci_erp` and authorise access to that repository.
2. **New → Blueprint**, pick the repository, and let it read `render.yaml`.
   Render will propose one service, `tci-analytics`.
3. It will prompt for the one secret marked `sync: false`. Paste:

   | Variable | Value |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | *(Supabase dashboard → Project Settings → API → `service_role`, "reveal", copy)* |

   Everything else (`SUPABASE_URL`, `CORS_ALLOW_ORIGINS`, `TRUST_PROXY_HEADERS`,
   `LOG_LEVEL`) is already in `render.yaml` and needs no input.
4. Deploy. When it goes live, copy the service URL from the top of the page —
   it will look like `https://tci-analytics.onrender.com` (Render appends a
   suffix if the name is taken, so use whatever it actually shows).
5. Check it: `curl https://<your-url>/health` → `{"status":"ok",...}`.

### Then point the frontend at it (owner)

Cloudflare Pages → the `tci-erp` project → **Settings → Environment variables**.
Add the same variable to **both** environments:

| Environment | Variable | Value |
|---|---|---|
| Production | `VITE_ANALYTICS_API_URL` | `https://<your-render-url>` |
| Preview | `VITE_ANALYTICS_API_URL` | `https://<your-render-url>` |

No trailing slash. Vite inlines this at **build** time, so redeploy the Pages
project afterwards (Deployments → Retry deployment) or push any commit —
setting the variable alone does not change the already-built bundle.

If the Render URL is not exactly `https://tci-erp.pages.dev` on the other side,
also update `CORS_ALLOW_ORIGINS` in Render to match the real Pages domain, or
the browser will block the calls.

### Redeploying

Push to `main`: `autoDeployTrigger: commit` in `render.yaml` rebuilds the
service. Manual redeploy is Render → the service → **Manual Deploy → Deploy
latest commit**. Changing an environment variable restarts the service on its
own; changing `VITE_ANALYTICS_API_URL` needs a Pages rebuild as above.

### Rotating the service-role key

Do this immediately if the key is ever pasted anywhere it should not be.

1. Supabase dashboard → Project Settings → API → `service_role` → **Rotate**.
   Everything using the old key stops working at that moment.
2. Render → `tci-analytics` → Environment → edit `SUPABASE_SERVICE_ROLE_KEY`,
   paste the new value, save. Render restarts the service automatically.
3. `curl https://<your-url>/users/provisioning-status` → `{"configured":true}`.
4. Update any local `.env` the same way.

There is nothing else to change: the key exists in exactly two places, this
service's environment and Supabase itself.

### Hardening applied for public exposure

| Concern | What is in place |
|---|---|
| CORS | exact allowlist (`CORS_ALLOW_ORIGINS`) plus an anchored regex for `*.tci-erp.pages.dev` previews and localhost. No `*`. |
| Body size | `MAX_BODY_BYTES` (default 1 MB), 413 before parsing |
| Timeouts | `REQUEST_TIMEOUT_SECONDS` (default 30) → 504; 15 s on Supabase calls, 10 s on CBU |
| Error opacity | unhandled errors return `{"detail":"internal error","request_id":…}`; the traceback goes to the log only. The CBU proxy no longer echoes the upstream error, which named the URL it called. |
| Logging | one JSON line per request (method, path, status, ms, ip, request id). No header values, no bodies, no token, no key. |
| Rate limits | provisioning only: `PROVISIONING_PER_IP_PER_HOUR` (20) as a **router dependency**, so it applies before authentication and an unauthenticated flood is not free; `PROVISIONING_PER_CALLER_PER_HOUR` (30) on top. 429 + `Retry-After`, and the body never says which bucket ran out. |
| Proxy headers | `X-Forwarded-For` is only believed when `TRUST_PROXY_HEADERS` is set, so a caller cannot forge its own rate-limit bucket |
| Container | non-root user (uid 10001), single worker, no build tools in the final image |
| Health | `GET /health`, used by `healthCheckPath` |

The rate limiter is an in-process fixed window. It resets on redeploy, and two
instances would each keep their own count. Both are fine at one small
instance; if this is ever scaled out, that is the piece to move to Redis.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | provisioning only | — | canonical project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | provisioning only | — | **secret**; bypasses RLS |
| `CORS_ALLOW_ORIGINS` | no | `https://tci-erp.pages.dev` + localhost | comma-separated exact origins |
| `CORS_PREVIEW_REGEX` | no | `^https://[a-z0-9][a-z0-9-]*\.tci-erp\.pages\.dev$` | preview subdomains |
| `MAX_BODY_BYTES` | no | `1000000` | request body cap |
| `REQUEST_TIMEOUT_SECONDS` | no | `30` | per-request deadline |
| `PROVISIONING_PER_IP_PER_HOUR` | no | `20` | rate limit |
| `PROVISIONING_PER_CALLER_PER_HOUR` | no | `30` | rate limit |
| `TRUST_PROXY_HEADERS` | on a host | unset | believe `X-Forwarded-For` |
| `LOG_LEVEL` | no | `INFO` | |

## Running the container locally

```bash
# from the REPOSITORY ROOT, not this directory
docker build -t tci-analytics .
docker run -p 8000:8000 --env-file services/analytics/.env tci-analytics
```

## Tests

```bash
uv run pytest
```

Supabase is mocked throughout — the suite never touches a real project.

## Endpoints

### Credit engine

- `GET /health` — liveness + engine version
- `POST /rating` — IFRS statement data + buyer meta → score, grade, component breakdown
- `POST /credit-limit` — rating result + financials → suggested limit with calculation trace
- `GET /grade-scale` — grade zone boundaries (single source of truth for the UI)
- `GET /fx?ccy=&date=` — CBU rate proxy (their API sends no CORS headers)

### Provisioning

All of these take `Authorization: Bearer <the caller's Supabase access token>`.

| Endpoint | Who may call it |
|---|---|
| `POST /users` | `admin` → any roles. `sales` / `commercial_underwriter` → `['client']` only; anything else is 403. |
| `POST /users/{id}/reset-password` | `admin` → anyone. `sales` / `commercial_underwriter` → client users mapped to a company only. |
| `POST /users/{id}/disable` | `admin` only (cannot disable yourself). |
| `POST /users/{id}/enable` | `admin` only. |
| `GET /users/provisioning-status` | anyone; reports only whether provisioning is configured. |

`POST /users` body: `email`, `full_name`, `roles[]`, `entity_id` (required
iff the roles include `client`), `send_email` (reserved — no SMTP is
configured, so the temporary password is shown on screen instead).

Both `POST /users` and the reset endpoint return a **temporary password
once**. It is never stored in our tables and never logged: if it is lost
before it reaches the user, reset the password again.

Creating a user is not atomic across two systems, so a failure while writing
roles, the profile row or the company mapping deletes the auth user again —
otherwise an account would exist that can sign in with no access at all.
