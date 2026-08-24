"""End-to-end assessment and commentary tests."""

from __future__ import annotations

import pytest

from credit_engine import assess
from credit_engine.models import Severity


class TestEndToEnd:
    def test_healthy_company_full_flow(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language="en")

        assert result.assessed_year == 2025
        assert result.rating.score is not None and result.rating.score < 45
        assert result.limit.recommended_limit > 0
        assert len(result.ratio_reports) == 3
        assert result.findings

        strengths = [f for f in result.findings if f.severity == Severity.STRENGTH]
        assert strengths, "a healthy company must have strength findings"

    def test_distressed_company_full_flow(self, distressed_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(distressed_company, language="en")

        assert result.rating.grade == "D"
        assert result.limit.recommended_limit == 0
        assert any(f.code == "limit.zero" for f in result.findings)
        assert any(f.severity == Severity.CRITICAL for f in result.findings)

    def test_result_is_json_serializable(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company)
        payload = result.model_dump_json()
        assert '"rating"' in payload and '"commentary"' in payload

    def test_deterministic(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        a = assess(healthy_company, language="ru")
        b = assess(healthy_company, language="ru")
        assert a == b


class TestCommentary:
    @pytest.mark.parametrize("lang", ["en", "ru", "uz"])
    def test_all_sections_render_in_all_languages(self, healthy_company, lang) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language=lang)
        for section in ("income_statement", "balance_sheet", "financial_ratios", "conclusion"):
            text = result.commentary[section]
            assert text and "{" not in text, f"unrendered placeholder in {section}: {text}"

    def test_default_language_is_russian(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company)
        assert result.language == "ru"
        assert "Выручка" in result.commentary["income_statement"]

    def test_conclusion_mentions_rating_and_limit(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language="en")
        conclusion = result.commentary["conclusion"]
        assert "credit rating" in conclusion.lower()
        assert "credit limit" in conclusion.lower()

    def test_distressed_conclusion_explains_zero_limit(self, distressed_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(distressed_company, language="en")
        conclusion = result.commentary["conclusion"]
        assert "No credit limit is recommended" in conclusion

    def test_unknown_language_raises(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        with pytest.raises(ValueError, match="unsupported language"):
            assess(healthy_company, language="de")

    def test_loss_is_narrated_as_loss(self, distressed_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(distressed_company, language="en")
        assert "net loss" in result.commentary["income_statement"]

    def test_income_and_balance_cover_all_key_lines(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language="en")
        income = result.commentary["income_statement"]
        assert "Gross profit" in income
        assert "administrative expenses" in income
        assert "Interest expenses" in income
        balance = result.commentary["balance_sheet"]
        assert "Non-current assets" in balance
        assert "inventories" in balance
        assert "Accounts payable" in balance

    def test_ratios_carry_qualitative_labels(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language="en")
        ratios = result.commentary["financial_ratios"]
        # current ratio 2.0 -> "adequate", ICR 8.7 -> "very high"
        assert "(adequate)" in ratios
        assert "(very high)" in ratios

    def test_cash_flow_section_absent_without_data(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        result = assess(healthy_company, language="en")
        assert "cash_flow" not in result.commentary

    def test_cash_flow_section_renders_when_data_present(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        periods = healthy_company.sorted_periods()
        with_cf = healthy_company.model_copy(
            update={
                "periods": [
                    *periods[:-1],
                    periods[-1].model_copy(
                        update={
                            "operating_cash_flow": 8_000_000.0,
                            "capital_expenditures": -3_000_000.0,
                        }
                    ),
                ]
            }
        )
        result = assess(with_cf, language="en")
        cash_flow = result.commentary["cash_flow"]
        assert "Operating cash flow was positive" in cash_flow
        assert "Capital expenditures" in cash_flow
        assert "Free cash flow is positive" in cash_flow

        ru = assess(with_cf, language="ru").commentary["cash_flow"]
        assert "Свободный денежный поток положительный" in ru
