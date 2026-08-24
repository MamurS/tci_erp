"""Credit limit calculation tests."""

from __future__ import annotations

import pytest

from credit_engine.limits import LimitConfig, calculate_limit, round_limit
from credit_engine.ratios import compute_period_ratios
from tests.conftest import make_period


def ratios(**overrides: float | None) -> dict[str, float | None]:
    return compute_period_ratios(make_period(2025, **overrides))


class TestRoundLimit:
    def test_thousands(self) -> None:
        assert round_limit(1_234_567) == 1_235_000
        assert round_limit(1500) == 2000

    def test_below_thousand_rounds_to_leading_magnitude(self) -> None:
        assert round_limit(870) == 900
        assert round_limit(43) == 40

    def test_zero_and_negative(self) -> None:
        assert round_limit(0) == 0
        assert round_limit(-100) == 0


class TestBenchmarkModel:
    def test_components_are_transparent(self) -> None:
        result = calculate_limit(30.0, ratios(), "USD", 1.0)
        assert result.model_used == "benchmark"
        bench = next(m for m in result.models if m.model == "benchmark")
        rc = bench.components["risk_coefficient"]
        assert rc == 1.0  # B1 band
        # material capital = equity - intangibles (NOT all non-current assets)
        assert bench.components["material_capital"] == pytest.approx(24_000_000)
        expected_a = 24_000_000 * 0.1 * rc
        dso = bench.components["dso_days"]
        expected_b = 80_000_000 * dso / 365 * rc
        assert bench.limit == pytest.approx((expected_a + expected_b) / 2)
        assert result.recommended_limit == round_limit(bench.limit)

    def test_better_rating_gives_bigger_limit(self) -> None:
        strong = calculate_limit(8.0, ratios(), "USD", 1.0)
        weak = calculate_limit(60.0, ratios(), "USD", 1.0)
        assert strong.recommended_limit > weak.recommended_limit > 0

    def test_missing_dso_uses_default_with_reason(self) -> None:
        r = ratios(accounts_receivable=None)
        result = calculate_limit(30.0, r, "USD", 1.0)
        bench = next(m for m in result.models if m.model == "benchmark")
        assert bench.components["dso_days"] == 45.0
        assert any("DSO" in reason for reason in result.reasons)


class TestHardZeroRules:
    def test_rating_above_75_zeroes_limit(self) -> None:
        result = calculate_limit(80.0, ratios(), "USD", 1.0)
        assert result.recommended_limit == 0
        assert any("worse than" in r for r in result.reasons)

    def test_negative_equity_zeroes_limit(self) -> None:
        result = calculate_limit(30.0, ratios(equity=-1_000_000), "USD", 1.0)
        assert result.recommended_limit == 0

    def test_tiny_equity_ratio_zeroes_limit(self) -> None:
        r = ratios(equity=100_000)  # 0.2% of 50M assets
        result = calculate_limit(30.0, r, "USD", 1.0)
        assert result.recommended_limit == 0

    def test_below_minimum_ticket_zeroes_limit(self) -> None:
        r = ratios(
            equity=30_000,
            revenue=20_000,
            accounts_receivable=1_000,
            total_assets=100_000,
        )
        result = calculate_limit(70.0, r, "USD", 1.0)
        assert result.recommended_limit == 0
        assert any("minimum ticket" in reason for reason in result.reasons)

    def test_no_rating_no_limit(self) -> None:
        result = calculate_limit(None, ratios(), "USD", 1.0)
        assert result.recommended_limit == 0
        assert result.model_used == "none"


class TestEquityBasedModel:
    def test_band_shares(self) -> None:
        result = calculate_limit(30.0, ratios(), "USD", 1.0)
        eq = next(m for m in result.models if m.model == "equity_based")
        # rating 30 -> [25, 35) band -> 70% of equity
        assert eq.limit == pytest.approx(25_000_000 * 0.7)

    def test_last_band_is_capped(self) -> None:
        result = calculate_limit(70.0, ratios(), "USD", 1.0)
        eq = next(m for m in result.models if m.model == "equity_based")
        assert eq.limit == pytest.approx(10_000)  # min(5% * 25M, 10k)

    def test_net_loss_zeroes_equity_model_only(self) -> None:
        r = ratios(net_profit=-1_000_000)
        result = calculate_limit(30.0, r, "USD", 1.0)
        eq = next(m for m in result.models if m.model == "equity_based")
        assert eq.limit == 0
        # benchmark still computes; rating already prices the loss in
        assert result.recommended_limit > 0

    def test_currency_conversion(self) -> None:
        # statement in UZS, 12500 UZS per USD -> equity is only 2,000 USD
        result = calculate_limit(70.0, ratios(), "UZS", 12_500.0)
        eq = next(m for m in result.models if m.model == "equity_based")
        assert eq.components["equity_usd"] == pytest.approx(2_000)
        # 5% of equity_usd, far below the 10k cap, converted back to UZS
        assert eq.limit == pytest.approx(2_000 * 0.05 * 12_500)


class TestConfig:
    def test_min_limit_configurable(self) -> None:
        r = ratios()
        config = LimitConfig(min_limit_usd=100_000_000.0)
        result = calculate_limit(30.0, r, "USD", 1.0, config)
        assert result.recommended_limit == 0
