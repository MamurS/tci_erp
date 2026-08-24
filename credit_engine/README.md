# Credit Engine

Credit rating, credit limit and financial analysis engine for the TCI ERP
(Mosaic Insurance Group). A ground-up rewrite of the legacy "Fineye" core:
same underwriting model, modern implementation.

**Pure domain library.** No database, no HTTP, no queues, no files. Input:
canonical financial statements. Output: a structured, explainable
`CreditAssessment`. Data ingestion, storage and PDF rendering live outside
this package (TCI ERP / future report module).

## Quick start

```python
from credit_engine import CompanyFinancials, FinancialPeriod, assess

company = CompanyFinancials(
    name="Example Trade LLC",
    age_years=12,
    currency="UZS",
    exchange_rate_usd=12_500,          # UZS per 1 USD
    periods=[
        FinancialPeriod(year=2024, total_assets=..., equity=..., revenue=..., ...),
        FinancialPeriod(year=2025, total_assets=..., equity=..., revenue=..., ...),
    ],
)

result = assess(company, language="ru")   # "en" | "ru" | "uz"

result.rating.score            # 42.7  (scale 1..100, LOWER IS BETTER)
result.rating.grade            # "B2"
result.rating.factors          # per-factor score, weight, band, status
result.rating.adjustments      # named rules that changed the rating
result.limit.recommended_limit # in statement currency
result.limit.models            # both models with components and reasons
result.findings                # structured strengths / weaknesses
result.commentary              # narrative paragraphs per report section
result.model_dump_json()       # everything is JSON-serializable
```

Development:

```bash
uv sync            # create venv, install deps
uv run pytest      # 58 tests
uv run ruff check .
uv run mypy        # strict
```

## Model methodology

### 1. Financial ratios (`ratios.py`)

~30 ratios per period (liquidity, leverage, profitability, turnover,
coverage) plus year-over-year dynamics. Division by zero or a missing input
yields `None` — never `inf` sentinels. EBIT = PBT + |interest expense| −
|interest income|, falling back to operating profit.

### 2. Credit rating (`scoring/`)

Scale **1..100, lower is better** (inherited so that all calibrated
threshold tables stay valid).

Thirteen factors, each scored via a threshold table and combined in a
weighted average:

| Factor | Base weight | Factor | Base weight |
|---|---|---|---|
| equity_ratio | 8 | current_ratio | 3 |
| net_profitability | 7 | revenue_usd (scale) | 3 |
| interest_coverage | 6 | total_assets_dynamic | 3 |
| revenue_dynamic | 5 | debt_to_equity | 2 |
| debt_to_ebit | 4 | cash_conversion_cycle | 2 |
| | | interest_coverage_dynamic | 2 |
| | | debt_to_assets | 1 |
| | | age_years | 1 |

Dynamic weight rules (from the legacy model, now explicit):

* equity ratio < 3% → equity weight +7; > 60% → +1
* asset collapse ≤ −50% → assets-trend weight +5
* net loss → revenue-trend weight +3; profitability > 15% → −2
* **revenue collapse ≤ −50% → revenue-trend weight +50** (crisis dominates)
* implied interest rate < 1% of debt → leverage weights ×0.5
  (non-market/intragroup financing)

Conditional tables: strong interest coverage (>6x) softens the
debt-to-equity bands; an asset collapse hardens the debt-to-assets bands.

Post-processing rules, each recorded as a named `Adjustment`:

| Rule | Effect |
|---|---|
| `weak_equity_dominance` | bad equity score outweighs an otherwise good rating |
| `negative_equity` | rating pulled toward 74 |
| `negative_equity_with_loss` | rating pulled toward 84 |
| `new_company` (age ≤ 1.5y) | rating floored near 74 — **only ever worsens** |
| `litigation_pressure` | defendant claims > 50% of revenue or > 50 cases → toward 74 |
| `insufficient_data` | < 50% of factor weight scored → floor at 70 |

Grade bands (aligned with the limit model's risk coefficients):

| Score | Grade | RC | | Score | Grade | RC |
|---|---|---|---|---|---|---|
| ≤10 | A1 | 1.5 | | ≤55 | B2 | 0.7 |
| ≤25 | A2 | 1.2 | | ≤65 | C1 | 0.4 |
| ≤40 | B1 | 1.0 | | ≤75 | C2 | 0.15 |
| | | | | >75 | D | 0 — no credit |

### 3. Credit limit (`limits.py`)

Primary **benchmark** model (Basel-style):

```
material_capital = max(0, equity − intangible_assets)
limit = (0.1 × material_capital × RC  +  revenue × DSO/365 × RC) / 2
```

Secondary **equity_based** model: equity in USD × band share
(0.9 / 0.7 / 0.5 / 0.3 / 0.1 / 0.05 capped at $10k), zeroed on negative
equity or a net loss.

Shared hard-zero rules: rating worse than 75, equity ≤ 0, equity ratio
< 1%, or a result below the minimum ticket ($5,000 equivalent). Every zero
carries an explicit reason. Both models are always reported with their
components; the recommendation uses the benchmark when computable.

### 4. Findings & commentary (`commentary/`)

* `Finding` objects — language-independent, machine-readable strengths /
  weaknesses / adjustments / limit rationale. This is what the ERP stores,
  and it renders **independently of the AI layer** — the justification for
  the rating and limit is always available.
* A deterministic **English draft** covering income statement (revenue,
  gross profit, opex, margins, interest, net result), balance sheet
  (structure, current asset composition, equity, debt, payables, NWC),
  ratios with qualitative labels tied to the scoring tables, cash flow
  (CFO / capex / FCF, when provided) and a conclusion. The draft is the
  factual anchor for the AI layer, not end-user text.

### 5. AI narrative layer (`narrative.py`)

User-facing commentary in **any language** is produced by one Claude API
call per report (`narrate(assessment, "ru", completer)`): the model
receives the structured fact sheet + the English draft and rewrites it as
a professional underwriter would, directly in the target language.
Polish + translation in a single step avoids meaning drift and halves cost.

Guardrails (the legacy system relied on hope; this one checks):

* The prompt pins every figure to the fact sheet / draft.
* **Programmatic number validation**: every digit sequence in the model
  output must already exist in the facts (robust to locale reformatting,
  e.g. `21.4%` vs `21,4 %`). A violation triggers one retry with the
  rejection reason; a second failure fails the request.
* **Availability policy**: any failure (API down, malformed reply, failed
  validation) raises `NarrativeUnavailableError`
  (`message_key = "commentary.service_unavailable"`). The ERP then shows
  "service unavailable, try again later" for the narrative — while the
  rating, limit, factor breakdown and adjustments render as usual.

The Claude client is injected behind a one-method `Completer` protocol:
tests run on a fake, and the provider can later be swapped for an
open-source model without touching the engine. `AnthropicCompleter` is the
production adapter (`pip install credit-engine[ai]`, default model
`claude-opus-5`; note that sampling parameters like temperature are
removed on Claude 5 models — stylistic variation comes from the model).

```python
from credit_engine import AnthropicCompleter, NarrativeUnavailableError, assess, narrate

assessment = assess(company)                      # pure, always works
try:
    commentary = await narrate(assessment, "ru", AnthropicCompleter())
except NarrativeUnavailableError:
    commentary = None                             # show "service unavailable"
```

### Missing-data policy (explicit by design)

* **Core factors** (profitability, equity ratio, leverage, liquidity,
  revenue): missing input → penalized at score 90 with normal weight.
* Secondary factors: excluded from the weighted average, with a warning.
* Coverage below 50% of total weight → rating floored at 70.
* Nothing scorable at all → `score = None` ("not computable"), limit 0.

## Deliberate changes vs the legacy Fineye model

The legacy implementation diverged from its own intended design. This
rewrite fixes those divergences **on purpose** (approved: new system, no
live limits to preserve):

1. `total_assets_dynamic` now participates in the rating (legacy scored the
   wrong input and dropped the factor from the sum).
2. Missing-data penalties actually apply (legacy penalty method was never
   called; missing data was free).
3. The new-company rule only worsens a rating (legacy pulled bad ratings
   *up* toward 74 too).
4. Court-case thresholds use the assessed company's own revenue (legacy
   read a leftover loop variable — usually another company's revenue).
5. Benchmark limit subtracts **intangible assets** only (legacy subtracted
   all non-current assets, crushing limits for asset-heavy companies).
6. The low-interest-rate leverage relief triggers at interest/debt < 1%
   (legacy formula `interest/debt − 1 < 0.01` was true almost always).
7. At a net loss the revenue-trend weight increases by +3 (legacy applied
   +3 then an unconditional −4, neutralizing its own rule).
8. Weights are honest floats in a weighted average (legacy multiplied
   score-lists and averaged the concatenation).
9. Commentary is deterministic (legacy used `random.choice`) and free of
   `inf`/`nan` artifacts scrubbed with string replaces.
10. Concurrency-safe by construction: no module-level mutable state (legacy
    leaked one report's numbers into the next).

## Integration with TCI ERP

Designed for the Phase 5 analytics service (`CLAUDE.md`): wrap `assess()`
in FastAPI, map `tci` schema rows to `FinancialPeriod`, store
`CreditAssessment.model_dump()` alongside the credit limit request. The
future PDF module consumes `findings` + `commentary` + `ratio_reports` —
no recomputation needed.
