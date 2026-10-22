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

## Cloudflare Containers

> **Status: prepared, not yet deployed.** The chosen host is Cloudflare
> Containers on the existing Cloudflare account. Everything the deploy needs is
> in [`deploy/cloudflare-analytics/`](../../deploy/cloudflare-analytics); what
> is left are the owner's dashboard steps below. Until they are done, users are
> created by hand with `docs/create-user.sql` (root `CLAUDE.md`, **Creating
> users while the service is unhosted**).

### How it is put together

```
browser ──https──▶ Worker "tci-analytics" (deploy/cloudflare-analytics/src/index.ts)
                     │  sets CF-Connecting-IP + X-Forwarded-For from the edge's
                     │  CF-Connecting-IP, drops every client-sent address header
                     ▼
                   Durable Object "AnalyticsContainer" (one instance, by name)
                     ▼
                   container: the repo-root Dockerfile, uvicorn on :8000
```

| What | Where | Value |
|---|---|---|
| Worker + container config | `deploy/cloudflare-analytics/wrangler.jsonc` | `image: ../../Dockerfile`, `image_build_context: ../..` (the repo root — the service needs `credit_engine/`) |
| Instance type | same | `lite` — 1/16 vCPU, 256 MiB, 2 GB disk (the service measures ~27 MiB RSS) |
| Instances | same | `max_instances: 2`; the Worker only ever addresses ONE instance, because the rate limiter is in-process. The second slot is headroom. |
| Sleep | `src/index.ts` | `sleepAfter = '10m'`: the container stops after 10 idle minutes (billing stops with it); the next request cold-starts it |
| Readiness probe | `src/index.ts` | `pingEndpoint = 'localhost/health'` |
| Container port | `src/index.ts` / `Dockerfile` | `8000` (`PORT` is passed explicitly) |
| Plain configuration | `wrangler.jsonc` → `vars` | committed, see the table below |
| Secrets | Worker → Settings → Variables and Secrets | set by the owner, never in the repo |

**Client IP.** `app/hardening.py` `client_ip()` trusts `CF-Connecting-IP`,
else the right-most `X-Forwarded-For` hop, and only when
`TRUST_PROXY_HEADERS=true`. The container has no public address — every request
reaches it through the Worker — and the Worker OVERWRITES `CF-Connecting-IP`
and `X-Forwarded-For` with the edge's `CF-Connecting-IP` and deletes
`X-Real-IP`, `True-Client-IP`, `Forwarded` and `CF-Connecting-IPv6`. Nothing a
client sends is appended. The Worker also drops `cf-container-target-port`,
which the `@cloudflare/containers` proxy would otherwise obey to pick the
container port. Locked by `deploy/cloudflare-analytics/test/forward.test.ts`.

**Environment.** The Worker passes exactly the variables this service reads
(the test reads them out of `app/*.py`, so a new one fails until it is listed
in `src/forward.ts`); an empty one is left out, so the service's own default
applies. The container reads its environment **when it starts**: a secret
added or changed later reaches the service at its next start, i.e. after 10
idle minutes, not immediately.

**Errors.** The service's own errors pass through unchanged (they are JSON and
opaque). When the container cannot be reached, or the proxy answers with its
own text error, the Worker returns `503 {"detail":"analytics service
unavailable"}` and logs the cause — the frontend already has an unavailable
state for this.

#### Variables passed to the container

| Variable | Kind | Value |
|---|---|---|
| `SUPABASE_URL` | var (`wrangler.jsonc`) | `https://reunqrpeumokqgarknge.supabase.co` |
| `CORS_ALLOW_ORIGINS` | var (`wrangler.jsonc`) | `https://tci-erp.pages.dev` — plus `,https://<custom-domain>` once one is added (by commit) |
| `TRUST_PROXY_HEADERS` | var (`wrangler.jsonc`) | `true` |
| `LOG_LEVEL` | var (`wrangler.jsonc`) | `INFO` |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** (dashboard) | Supabase → Project Settings → API keys → `service_role` |
| `COMPANIES_HOUSE_API_KEY` | **secret** (dashboard), optional | key from developer.company-information.service.gov.uk; unset = source off |
| `CORS_PREVIEW_REGEX`, `MAX_BODY_BYTES`, `REQUEST_TIMEOUT_SECONDS`, `PROVISIONING_PER_IP_PER_HOUR`, `PROVISIONING_PER_CALLER_PER_HOUR`, `COMPUTE_PER_IP_PER_HOUR` | not set | the service defaults (see **Environment variables** below) apply |
| `PORT` | set by the Worker | `8000` |

Plain vars live in `wrangler.jsonc` on purpose: every deploy re-applies them,
so a value edited only in the dashboard would be overwritten by the next push.
Change them by commit. Secrets are never touched by a deploy.

**CORS.** No code change is needed for Cloudflare Pages. Production
`https://tci-erp.pages.dev` is matched exactly by `CORS_ALLOW_ORIGINS`;
commit previews (`https://<hash>.tci-erp.pages.dev`) and branch aliases
(`https://<branch>.tci-erp.pages.dev`) by the anchored default
`^https://[a-z0-9][a-z0-9-]*\.tci-erp\.pages\.dev$`. Do not list previews, and
never use `*`. Setting `CORS_ALLOW_ORIGINS` replaces the localhost defaults,
which is what production wants.

### Owner steps

All in the Cloudflare dashboard of the account that already serves the
`tci-erp` Pages project.

1. **Enable Workers Paid ($5/month).** [Workers & Pages → Plans](https://dash.cloudflare.com/?to=/:account/workers/plans)
   → **Workers Paid** → *Purchase*. Containers have no free tier.
2. **Create the Worker from the repository** (Workers Builds).
   [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
   → **Create application** → **GitHub** (authorise `MamurS/tci_erp` if asked)
   → pick the repository, then set:

   | Field | Value |
   |---|---|
   | Project / Worker name | `tci-analytics` (must equal `name` in `wrangler.jsonc`) |
   | Production branch | `main` |
   | Build command | *(leave empty — Workers Builds installs `package.json` dependencies itself)* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory (under *Advanced settings*) | `deploy/cloudflare-analytics` |

   **Save and Deploy.** The build compiles the Docker image from the repo
   root; the first one takes several minutes, and container requests can fail
   for a few more minutes while Cloudflare provisions the image.
3. **Build settings** — the Worker → **Settings → Build**:
   * **Branch control**: untick *Enable Preview Builds*. Only `wrangler deploy`
     on the production branch updates the container; previews would only add
     builds.
   * **Build watch paths** → Include: `deploy/cloudflare-analytics/*`,
     `services/analytics/*`, `credit_engine/*`, `Dockerfile`,
     `.dockerignore`. A frontend-only commit then does not rebuild the
     service.
4. **Set the secrets — before the first request reaches the service.** The
   Worker → **Settings → Variables and Secrets → Add** → type **Secret**:

   | Name | Value |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API keys → `service_role` → reveal → copy |
   | `COMPANIES_HOUSE_API_KEY` | *(optional)* the Companies House key; skip to leave the UK source off |

   **Deploy.** Do not add the plain vars here — they come from
   `wrangler.jsonc`.
5. **Find the service URL.** The Worker → **Settings → Domains & Routes**
   shows `https://tci-analytics.<your-account-subdomain>.workers.dev`.
   That is `<service-url>` below.
6. **Verify.** Open, or `curl`:
   * `<service-url>/health` → `{"status":"ok","engine_version":"…"}` (the first
     call cold-starts the container — give it up to ~20 s, retry once if it
     answers 503);
   * `<service-url>/users/provisioning-status` → `{"configured":true}`.
     `false` means the service started without the secret: check step 4,
     wait 10 minutes without calling the service (the container goes to
     sleep), and try again.
7. **Point the frontend at it.** [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
   → the **`tci-erp`** Pages project → **Settings → Variables and Secrets → Add**,
   type *Text*, once for **Production** and once for **Preview**:

   | Variable | Value |
   |---|---|
   | `VITE_ANALYTICS_API_URL` | `<service-url>` — no trailing slash |

   Vite inlines it at BUILD time: **Deployments → … → Retry deployment** on the
   latest production deployment (or push any commit).
8. **Hand the URL to the developer** for the CSP change below. Until that
   change is deployed, the browser blocks every call to the service and the
   screens stay in their unavailable state.

### Then the developer

* Add `<service-url>` to `connect-src` in `TCI_ERP/public/_headers`
  (the comment there already says so), e.g.
  `connect-src 'self' https://reunqrpeumokqgarknge.supabase.co wss://reunqrpeumokqgarknge.supabase.co https://tci-analytics.<sub>.workers.dev;`
  — the exact origin, never `*.workers.dev`. Re-run the headless CSP check.
* If the owner adds a custom domain to the Pages project, append it to
  `CORS_ALLOW_ORIGINS` in `deploy/cloudflare-analytics/wrangler.jsonc`.
* Update the status lines in the root `CLAUDE.md` and in this README.

### Redeploying, logs, rotation

* **Redeploy**: push to `main` touching a watched path; or the Worker →
  **Deployments → View build history → Retry build**. A deploy that changes
  the image or the container config rolls the container; a Worker-only
  change does not.
* **Logs**: the Worker → **Observability**, or [Workers & Pages → Containers](https://dash.cloudflare.com/?to=/:account/workers/containers)
  for instance status. The service's JSON access lines appear there (no
  header values, no bodies, no key).
* **Rotate the service-role key**: rotate in Supabase, replace
  `SUPABASE_SERVICE_ROLE_KEY` in the Worker's Variables and Secrets →
  **Deploy**, then wait 10 idle minutes (or retry a build that changes the
  image) so the container restarts with it; check
  `/users/provisioning-status`.
* **Local run** (developer, needs Docker): `cd deploy/cloudflare-analytics &&
  npm ci && npx wrangler dev`, with test values in a git-ignored `.dev.vars`.
  Never `wrangler deploy` from a laptop with real secrets in `.dev.vars`.

### Checks

```bash
cd deploy/cloudflare-analytics
npm ci
npm run typecheck   # the Worker (workers types) and the tests (node types)
npm test            # node --test: IP rewrite, env list vs app/*.py, port, /health
```

### Documentation relied on (checked 2026-10-22)

* Get started — <https://developers.cloudflare.com/containers/get-started/>
* Wrangler configuration for Containers — <https://developers.cloudflare.com/containers/configuration/wrangler/>
  and the full field reference — <https://developers.cloudflare.com/workers/wrangler/configuration/#containers>
* Scheduling policies (`default` vs `durable_object`) — <https://developers.cloudflare.com/containers/configuration/scheduling-policy/>
* `Container` class (`defaultPort`, `sleepAfter`, `envVars`, `pingEndpoint`) — <https://developers.cloudflare.com/containers/api/container-class/>
  and <https://www.npmjs.com/package/@cloudflare/containers>
* API comparison — <https://developers.cloudflare.com/containers/api/>
* Environment variables — <https://developers.cloudflare.com/containers/configuration/environment-variables/>
  and secrets — <https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/>,
  <https://developers.cloudflare.com/workers/configuration/secrets/>,
  global `env` — <https://developers.cloudflare.com/workers/runtime-apis/bindings/>
* Instance types and limits — <https://developers.cloudflare.com/containers/platform/limits/>
* Pricing — <https://developers.cloudflare.com/containers/platform/pricing/>
* Deploy, incl. Workers Builds — <https://developers.cloudflare.com/containers/guides/deploy/>
* Workers Builds — <https://developers.cloudflare.com/workers/ci-cd/builds/>,
  <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>,
  <https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/>,
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/>,
  <https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/>
  and the build image (auto-install, x86_64) — <https://developers.cloudflare.com/workers/ci-cd/builds/build-image/>
* workers.dev — <https://developers.cloudflare.com/workers/configuration/routing/workers-dev/>
* `CF-Connecting-IP` / `X-Forwarded-For` — <https://developers.cloudflare.com/fundamentals/reference/http-headers/>
* FAQ (cold starts, logs, placement) — <https://developers.cloudflare.com/containers/faq/>

## Deployment

> **Superseded by [Cloudflare Containers](#cloudflare-containers)**, the chosen
> host. The Render runbook below is kept as a fallback; `render.yaml` still
> works unchanged.

The service deploys as a Docker container from this repository. Everything
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
| Rate limits | provisioning: `PROVISIONING_PER_IP_PER_HOUR` (20) as a **router dependency**, so it applies before authentication and an unauthenticated flood is not free; `PROVISIONING_PER_CALLER_PER_HOUR` (30) on top. 429 + `Retry-After`, and the body never says which bucket ran out. `/rating`, `/credit-limit` and `/fx`: `COMPUTE_PER_IP_PER_HOUR` (600) per IP, counted before the body is validated. |
| Proxy headers | only believed when `TRUST_PROXY_HEADERS` is set, so a caller cannot forge its own rate-limit bucket; then `CF-Connecting-IP` wins, else the RIGHT-most `X-Forwarded-For` hop (the one the proxy appended — the left ones are whatever the client sent) |
| Caller state | provisioning resolves the caller AND asks `tci.my_auth_status()` with the caller's own token: an unrotated temporary password, an unmet MFA policy or an active lockout is a 403 (`password_rotation_required` / `mfa_required` / `account_locked`), exactly as `has_role`/`is_staff` close in the database. The roles themselves are read with the service key, which would otherwise see past those gates |
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
| `COMPUTE_PER_IP_PER_HOUR` | no | `600` | rate limit on rating / limit / fx / registry |
| `COMPANIES_HOUSE_API_KEY` | no | unset | **secret**; turns on the UK Companies House registry source |
| `TRUST_PROXY_HEADERS` | on a host | unset | believe `CF-Connecting-IP` / `X-Forwarded-For` |
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

### Company registries

- `GET /registry/sources` — which sources are on (`gleif` always;
  `companies_house` when `COMPANIES_HOUSE_API_KEY` is set)
- `GET /registry/search?source=&q=&country=` — up to 10 records in one
  shape (name, country, registration number, address, legal form, status,
  founding date, a link to the source). A record is a suggestion: the
  information manager confirms it in the company form. Upstream errors are
  502 with no upstream text; the key is never logged.

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
