# TCI Analytics Service

FastAPI service exposing the credit engine (rating + credit limit) to the
TCI ERP frontend. Localhost only for now; no database connection - the
frontend fetches statement data from Supabase and POSTs it here.

## Run locally

```bash
cd services/analytics
uv sync
uv run uvicorn app.main:app --port 8000
# docs: http://localhost:8000/docs
```

## Tests

```bash
uv run pytest
```

## Endpoints

- `GET /health` - liveness + engine version
- `POST /rating` - IFRS statement data + buyer meta -> score, grade, component breakdown
- `POST /credit-limit` - rating result + financials -> suggested limit with calculation trace
