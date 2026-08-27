"""Analytics service tests: adapter + endpoints (TestClient, no network)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.adapter import UNIT_SCALE, build_company, resolve_exchange_rate
from app.main import app
from app.schemas import StatementPayload, TciPeriod

client = TestClient(app)


def period(year: int, **overrides: float | None) -> dict[str, object]:
    balance = {
        "total_assets": 210_000_000,
        "total_non_current_assets": 65_000_000,
        "intangible_assets": 2_000_000,
        "inventories": 52_000_000,
        "trade_receivables": 45_000_000,
        "cash_and_equivalents": 18_000_000,
        "total_current_assets": 145_000_000,
        "total_equity": 88_000_000,
        "long_term_borrowings": 28_000_000,
        "short_term_borrowings": 30_000_000,
        "trade_payables": 48_000_000,
        "total_current_liabilities": 90_000_000,
    }
    income = {
        "revenue": 510_000_000,
        "cost_of_sales": 410_000_000,
        "gross_profit": 100_000_000,
        "distribution_expenses": 25_000_000,
        "administrative_expenses": 18_000_000,
        "operating_profit": 57_000_000,
        "finance_costs": 9_000_000,
        "profit_before_tax": 49_000_000,
        "net_profit": 37_000_000,
    }
    for key, value in overrides.items():
        (balance if key in balance or key.startswith("total") else income)[key] = value
    return {
        "fiscal_year": year,
        "statement_kind": "annual",
        "balance_sheet": balance,
        "income_statement": income,
    }


def payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "buyer": {"name": "Test LLC", "country_code": "UZ", "age_years": 8},
        "currency": "UZS",
        "unit": "thousands",
        "periods": [period(2024, revenue=420_000_000), period(2025)],
    }
    base.update(overrides)
    return base


class TestAdapter:
    def test_unit_scaling(self) -> None:
        raw = StatementPayload.model_validate(payload(unit="thousands"))
        company, _ = build_company(raw)
        latest = company.sorted_periods()[-1]
        assert latest.total_assets == 210_000_000 * 1_000
        assert latest.revenue == 510_000_000 * 1_000

    def test_unit_scale_table(self) -> None:
        assert UNIT_SCALE == {"units": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0}

    def test_default_fx_rates(self) -> None:
        assert resolve_exchange_rate("UZS", None) == (12_500.0, None)
        assert resolve_exchange_rate("usd", None) == (1.0, None)
        rate, warning = resolve_exchange_rate("XXX", None)
        assert rate == 1.0
        assert warning is not None

    def test_explicit_rate_wins(self) -> None:
        assert resolve_exchange_rate("UZS", 13_000.0) == (13_000.0, None)

    def test_field_mapping(self) -> None:
        raw = StatementPayload.model_validate(payload(unit="units"))
        company, _ = build_company(raw)
        latest = company.sorted_periods()[-1]
        assert latest.non_current_assets == 65_000_000
        assert latest.accounts_receivable == 45_000_000
        assert latest.commercial_expenses == 25_000_000
        assert latest.interest_expenses == 9_000_000


class TestHealth:
    def test_health(self) -> None:
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert body["engine_version"]


class TestRatingEndpoint:
    def test_healthy_company_rating(self) -> None:
        response = client.post("/rating", json=payload())
        assert response.status_code == 200
        body = response.json()
        assert body["score"] is not None and body["score"] < 60
        assert body["grade"] in ("A1", "A2", "B1", "B2")
        assert len(body["components"]) == 13
        assert body["data_coverage"] > 0.5
        assert body["engine_version"]

    def test_components_are_explained(self) -> None:
        body = client.post("/rating", json=payload()).json()
        revenue_component = next(c for c in body["components"] if c["factor"] == "revenue_usd")
        # 510 bln UZS thousands -> USD via default 12500 rate
        assert revenue_component["value"] is not None
        assert revenue_component["band"] is not None

    def test_invalid_payload_is_422(self) -> None:
        assert client.post("/rating", json={"periods": []}).status_code == 422


class TestCreditLimitEndpoint:
    def test_limit_with_trace(self) -> None:
        response = client.post("/credit-limit", json=payload(rating_score=42.0))
        assert response.status_code == 200
        body = response.json()
        assert body["suggested_limit"] > 0
        assert body["currency"] == "UZS"
        assert body["model_used"] == "benchmark"
        models = {m["model"] for m in body["trace"]}
        assert models == {"benchmark", "equity_based"}
        benchmark = next(m for m in body["trace"] if m["model"] == "benchmark")
        assert "risk_coefficient" in benchmark["components"]

    def test_bad_rating_zeroes_limit(self) -> None:
        body = client.post("/credit-limit", json=payload(rating_score=90.0)).json()
        assert body["suggested_limit"] == 0
        assert body["reasons"]

    def test_rating_score_required(self) -> None:
        assert client.post("/credit-limit", json=payload()).status_code == 422


class TestGradeScale:
    def test_bands_cover_1_to_100_in_order(self) -> None:
        bands = client.get("/grade-scale").json()
        assert len(bands) == 7
        assert bands[0]["code"] == "A1" and bands[0]["lower"] == 0
        assert bands[-1]["code"] == "D" and bands[-1]["upper"] == 100
        for prev, cur in zip(bands, bands[1:]):
            assert cur["lower"] == prev["upper"]
        # risk coefficients decrease as the score worsens
        rcs = [b["risk_coefficient"] for b in bands]
        assert rcs == sorted(rcs, reverse=True)
        # each band declares its FAMILY - the unit the authority matrix
        # (tci.grade_band) is keyed by; consumers must not derive it.
        assert [b["family"] for b in bands] == ["A", "A", "B", "B", "C", "C", "D"]
        assert {b["family"] for b in bands} == {"A", "B", "C", "D"}
        for band in bands:
            assert band["family"] == band["code"][0]
