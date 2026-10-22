# legacy/

Archived material that is **not part of TCI ERP**. Nothing here is built,
tested, deployed or imported: the app (`TCI_ERP/`), the analytics service
(`services/analytics/`) and `credit_engine/` do not reference these paths,
and `.dockerignore` keeps the whole directory out of the image. It sits here
instead of the repository root since audit Phase B (repo hygiene, finding
S-6), so the root holds only what the system is made of. It is kept for
reference; the owner may remove it from the repository altogether, and git
history keeps it either way.

| Directory | What it is |
|---|---|
| `Fineye/` | The legacy **Fineye** analysis worker (Python, AMQP RPC): statement mapping, ratios, grade and credit-limit calculation, generated commentary, HTML → PDF reports. `credit_engine/` is a ground-up rewrite of its core; the threshold tables it inherited are documented there. Vendored 2026-08-24 (commit `76a7dbb`). |
| `Fineye_api/` | The legacy Fineye HTTP API (FastAPI): users, billing, statistics and the routes that fed the worker over AMQP. Vendored with `Fineye/`. |
| `Fineye_dim/` | The legacy Fineye data-ingestion service: a reference-data database (SQLAlchemy) and adapters for Russian registries (FNS financial and registration data, court cases, group data). Vendored with `Fineye/`. An api-fns.ru token was hard-coded in it until audit Phase A2; it stays in git history (see `.gitleaksignore`, whose fingerprint names the file's path in that old commit) and must be rotated on api-fns.ru. |
| `CREDIT REPORT SAMPLE/` | Two PDFs used as references for the risk report: a legacy credit report on a Russian company, and an early generated Risk Report sample (commit `fd72086`). The first names a real company by its registration number — do not publish. |
| `СКРИНЩОТЫ ИСКК/` | Ten screenshots (2026-08-25) of the legacy system's screens. Phase 1e (credit limit requests/decisions) is to be modelled on screenshots of the legacy system, so keep them until that phase is designed. |
