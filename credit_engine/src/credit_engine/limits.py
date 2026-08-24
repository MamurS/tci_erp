"""Credit limit calculation.

Two models, both inherited from the legacy calculator and made explicit:

* ``benchmark`` (primary, Basel-style):
    working_capital_component = 0.1 * (equity - intangibles) * rc
    trade_component           = revenue * DSO / 365 * rc
    limit = (working_capital_component + trade_component) / 2
  where ``rc`` is the risk coefficient of the rating band.

* ``equity_based`` (secondary, conservative):
    limit_usd = equity_usd * band_share  (0.9 / 0.7 / 0.5 / 0.3 / 0.1 / 0.05)
  zeroed on negative equity, net loss, or equity_ratio < 1%.

Deliberate fixes vs legacy:
* intangibles = the actual ``intangible_assets`` input (legacy subtracted ALL
  non-current assets, materially understating limits for asset-heavy firms).
  When intangibles are unknown they are treated as 0 with a warning.
* The benchmark no longer silently swallows arbitrary exceptions to fall
  back - fallback happens only for defined reasons, which are reported.
* Hard-zero rules are shared and explicit: rating worse than 75, negative
  equity, equity ratio below 1%, or a result below the minimum ticket.
"""

from __future__ import annotations

from dataclasses import dataclass

from credit_engine.models import LimitModelResult, LimitResult
from credit_engine.scoring.tables import grade_for


@dataclass(frozen=True)
class LimitConfig:
    min_limit_usd: float = 5_000.0
    default_dso_days: float = 45.0
    equity_share_bands: tuple[tuple[float, float], ...] = (
        (25.0, 0.9),
        (35.0, 0.7),
        (45.0, 0.5),
        (55.0, 0.3),
        (65.0, 0.1),
        (75.0, 0.05),
    )
    equity_based_cap_last_band_usd: float = 10_000.0
    no_credit_rating_threshold: float = 75.0
    min_equity_ratio: float = 0.01


def round_limit(value: float) -> float:
    """Presentation rounding: >=1000 to the nearest 1000, below that to the
    magnitude of the leading digit (legacy custom_round)."""
    if value <= 0:
        return 0.0
    if value >= 1000:
        return float(round(value / 1000) * 1000)
    magnitude = 10 ** (len(str(int(value))) - 1)
    return float(round(value / magnitude) * magnitude)


def _benchmark_model(
    rating: float,
    ratios: dict[str, float | None],
    currency: str,
    exchange_rate_usd: float,
    config: LimitConfig,
) -> LimitModelResult:
    reasons: list[str] = []
    rc = grade_for(rating).risk_coefficient

    equity = ratios.get("equity") or 0.0
    intangibles = ratios.get("intangible_assets")
    if intangibles is None:
        intangibles = 0.0
        reasons.append("intangible assets unknown - assumed 0")

    dso = ratios.get("days_sales_outstanding")
    if dso is None or dso <= 0:
        dso = config.default_dso_days
        reasons.append(f"DSO unavailable - default {config.default_dso_days:.0f} days used")
    dso = min(dso, 365.0)

    revenue = ratios.get("revenue") or 0.0

    material_capital = max(0.0, equity - intangibles)
    working_capital_component = material_capital * 0.1 * rc
    trade_component = revenue * dso / 365.0 * rc
    limit = (working_capital_component + trade_component) / 2.0

    return LimitModelResult(
        model="benchmark",
        limit=max(0.0, limit),
        currency=currency,
        components={
            "risk_coefficient": rc,
            "material_capital": material_capital,
            "working_capital_component": working_capital_component,
            "trade_component": trade_component,
            "dso_days": dso,
        },
        reasons=reasons,
    )


def _equity_based_model(
    rating: float,
    ratios: dict[str, float | None],
    currency: str,
    exchange_rate_usd: float,
    config: LimitConfig,
) -> LimitModelResult:
    reasons: list[str] = []
    equity = ratios.get("equity")
    net_profit = ratios.get("net_profit")

    equity_usd = (equity or 0.0) / exchange_rate_usd

    limit_usd = 0.0
    if equity is not None and equity > 0 and net_profit is not None and net_profit > 0:
        for upper, share in config.equity_share_bands:
            if rating < upper:
                limit_usd = equity_usd * share
                if upper == config.equity_share_bands[-1][0]:
                    limit_usd = min(limit_usd, config.equity_based_cap_last_band_usd)
                break
        else:
            reasons.append("rating outside creditable bands")
    else:
        if equity is None or equity <= 0:
            reasons.append("equity is zero, negative or unknown")
        if net_profit is None or net_profit <= 0:
            reasons.append("net result is a loss or unknown")

    return LimitModelResult(
        model="equity_based",
        limit=max(0.0, limit_usd * exchange_rate_usd),
        currency=currency,
        components={"equity_usd": equity_usd, "limit_usd": limit_usd},
        reasons=reasons,
    )


def calculate_limit(
    rating: float | None,
    ratios: dict[str, float | None],
    currency: str,
    exchange_rate_usd: float,
    config: LimitConfig | None = None,
) -> LimitResult:
    config = config or LimitConfig()
    reasons: list[str] = []

    if rating is None:
        return LimitResult(
            recommended_limit=0.0,
            currency=currency,
            model_used="none",
            models=[],
            reasons=["rating not computable - no credit limit can be recommended"],
        )

    benchmark = _benchmark_model(rating, ratios, currency, exchange_rate_usd, config)
    equity_based = _equity_based_model(rating, ratios, currency, exchange_rate_usd, config)
    models = [benchmark, equity_based]

    # --- shared hard-zero rules ---
    equity = ratios.get("equity")
    equity_ratio = ratios.get("equity_ratio")

    if rating > config.no_credit_rating_threshold:
        reasons.append(f"rating {rating:.0f} is worse than {config.no_credit_rating_threshold:.0f}")
        return LimitResult(
            recommended_limit=0.0, currency=currency, model_used="none",
            models=models, reasons=reasons,
        )
    if equity is not None and equity <= 0:
        reasons.append("equity is zero or negative")
        return LimitResult(
            recommended_limit=0.0, currency=currency, model_used="none",
            models=models, reasons=reasons,
        )
    if equity_ratio is not None and equity_ratio < config.min_equity_ratio:
        reasons.append("equity ratio below 1% of the balance sheet")
        return LimitResult(
            recommended_limit=0.0, currency=currency, model_used="none",
            models=models, reasons=reasons,
        )

    chosen = benchmark if benchmark.limit > 0 else equity_based
    limit = chosen.limit

    min_limit = config.min_limit_usd * exchange_rate_usd
    if limit < min_limit:
        reasons.append(
            f"calculated limit is below the minimum ticket "
            f"({config.min_limit_usd:,.0f} USD equivalent)"
        )
        return LimitResult(
            recommended_limit=0.0, currency=currency, model_used=chosen.model,
            models=models, reasons=reasons,
        )

    reasons.extend(chosen.reasons)
    return LimitResult(
        recommended_limit=round_limit(limit),
        currency=currency,
        model_used=chosen.model,
        models=models,
        reasons=reasons,
    )
