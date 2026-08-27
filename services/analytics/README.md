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

## Deployment status (known limitation)

The service runs **locally only**. On the deployed site (Cloudflare Pages)
the provisioning screens show a «Сервис подготовки пользователей недоступен»
state — the same pattern the Rating tab uses when the engine is unreachable.
Everything else in the app works normally. Deploying this service to a host
that can hold the service-role key is a separate future task; until then,
user provisioning is done by running the service on an operator's machine.

`GET /users/provisioning-status` exists for that UI state: it reports
whether the key is configured, and nothing about it.

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
