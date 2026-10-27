"""Sector grade and country risk category (credit_engine.risk_context)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from credit_engine import (
    CompanyFinancials,
    RiskContext,
    adjust_grade,
    apply_risk_context,
    assess,
    effective_score,
)
from credit_engine.limits import calculate_limit
from credit_engine.models import RatingResult
from credit_engine.ratios import build_ratio_reports
from credit_engine.scoring.tables import GRADE_BANDS, grade_for
from credit_engine_api.app import create_app
from tests.test_api import company_payload

GOLDEN = Path(__file__).parent / "golden"
SCALE = tuple(band.code for band in GRADE_BANDS)

#: The defaults of tci.risk_adjustment_settings.
DEFAULT_ADJUSTMENTS: dict[str, Any] = {
    "sector": {
        "A": {"notch": 1, "cap_grade": None},
        "B": {"notch": 0, "cap_grade": None},
        "C": {"notch": -1, "cap_grade": None},
        "D": {"notch": -2, "cap_grade": None},
    },
    "country": {
        **{str(c): {"notch": 0, "cap_grade": None} for c in range(6)},
        "6": {"notch": 0, "cap_grade": "C1"},
        "7": {"notch": 0, "cap_grade": "C1"},
        "unclassified": {"notch": 0, "cap_grade": None},
    },
}


def context(**overrides: Any) -> RiskContext:
    data: dict[str, Any] = {
        "sector_grade": "B",
        "country_category": 3,
        "country_classified": True,
        "country_source": "oecd",
        "adjustments": DEFAULT_ADJUSTMENTS,
    }
    data.update(overrides)
    return RiskContext.model_validate(data)


def latest_ratios(company: CompanyFinancials) -> dict[str, float | None]:
    return build_ratio_reports(company)[-1].ratios


class TestScale:
    def test_the_engine_scale_is_what_the_adjustment_walks(self) -> None:
        assert SCALE == ("A1", "A2", "B1", "B2", "C1", "C2", "D")


class TestNoContextRegression:
    """Without a risk context the output is byte-for-byte what it was."""

    def test_healthy_fixture(self, healthy_company: CompanyFinancials) -> None:
        expected = (GOLDEN / "assess_healthy_en.json").read_text()
        assert assess(healthy_company).model_dump_json(indent=2) + "\n" == expected

    def test_distressed_fixture(self, distressed_company: CompanyFinancials) -> None:
        expected = (GOLDEN / "assess_distressed_en.json").read_text()
        assert assess(distressed_company).model_dump_json(indent=2) + "\n" == expected

    def test_api_response(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        response = client.post(
            "/v1/assess", json={"company": company_payload(), "narrative": False}
        )
        assert response.status_code == 200
        assert response.content + b"\n" == (GOLDEN / "api_assess.json").read_bytes()

    def test_no_risk_keys_without_context(self, healthy_company: CompanyFinancials) -> None:
        rating = assess(healthy_company).model_dump()["rating"]
        for key in ("base_grade", "effective_score", "risk_context", "risk_adjustments"):
            assert key not in rating


class TestNotches:
    def test_sector_b_country_3_changes_nothing(
        self, healthy_company: CompanyFinancials
    ) -> None:
        plain = assess(healthy_company)
        result = assess(healthy_company, risk_context=context())
        assert plain.rating.grade == "B2"
        assert result.rating.grade == "B2"
        assert result.rating.base_grade == "B2"
        assert result.rating.score == plain.rating.score
        assert result.rating.effective_score == plain.rating.score
        assert result.limit == plain.limit

    def test_sector_a_notches_up(self, healthy_company: CompanyFinancials) -> None:
        result = assess(healthy_company, risk_context=context(sector_grade="A"))
        assert result.rating.base_grade == "B2"
        assert result.rating.grade == "B1"
        assert result.rating.grade_label_key == "grade.good"
        assert result.rating.score == 42.7  # the score itself never moves

    def test_sector_d_notches_down_two(self, healthy_company: CompanyFinancials) -> None:
        result = assess(healthy_company, risk_context=context(sector_grade="D"))
        assert result.rating.grade == "C2"

    def test_sector_and_country_combine(self) -> None:
        table = {**DEFAULT_ADJUSTMENTS, "country": {"4": {"notch": -1}}}
        used = context(sector_grade="C", country_category=4, adjustments=table)
        outcome = adjust_grade("B1", used)
        assert outcome.grade == "C1"  # -1 sector, -1 country
        sector, country = outcome.lines
        assert (sector.from_grade, sector.to_grade) == ("B1", "B2")
        assert (country.from_grade, country.to_grade) == ("B2", "C1")

    def test_opposite_notches_cancel(self) -> None:
        table = {**DEFAULT_ADJUSTMENTS, "country": {"5": {"notch": -1}}}
        used = context(sector_grade="A", country_category=5, adjustments=table)
        outcome = adjust_grade("B2", used)
        assert outcome.grade == "B2"

    def test_missing_rows_mean_no_notch(self) -> None:
        outcome = adjust_grade("B2", context(sector_grade="D", adjustments={}))
        assert outcome.grade == "B2"
        assert [line.notch for line in outcome.lines] == [0, 0]

    def test_null_sector_grade_has_no_sector_line(self) -> None:
        outcome = adjust_grade("B2", context(sector_grade=None))
        assert [line.code for line in outcome.lines] == ["country_adjustment"]


class TestClamping:
    def test_clamped_at_the_top(self) -> None:
        assert adjust_grade("A1", context(sector_grade="A")).grade == "A1"
        table = {"sector": {"A": {"notch": 3}}, "country": {"3": {"notch": 2}}}
        assert adjust_grade("B1", context(sector_grade="A", adjustments=table)).grade == "A1"

    def test_clamped_at_the_bottom(self) -> None:
        assert adjust_grade("C2", context(sector_grade="D")).grade == "D"
        assert adjust_grade("D", context(sector_grade="D")).grade == "D"

    def test_clamp_applies_to_the_total(self) -> None:
        # +1 then -1 from A1: the TOTAL is 0, so the grade stays A1.
        table = {"sector": {"A": {"notch": 1}}, "country": {"3": {"notch": -1}}}
        assert adjust_grade("A1", context(sector_grade="A", adjustments=table)).grade == "A1"


class TestCaps:
    @pytest.mark.parametrize("category", [6, 7])
    def test_country_6_and_7_cap_at_c1(self, category: int) -> None:
        outcome = adjust_grade("B2", context(country_category=category))
        assert outcome.grade == "C1"
        cap = outcome.lines[-1]
        assert cap.code == "grade_cap"
        assert cap.model_dump() == {
            "code": "grade_cap",
            "cap_grade": "C1",
            "cap_sources": ["country"],
            "from_grade": "B2",
            "to_grade": "C1",
        }

    @pytest.mark.parametrize("category", range(6))
    def test_country_0_to_5_do_not_cap(self, category: int) -> None:
        outcome = adjust_grade("A1", context(country_category=category))
        assert outcome.grade == "A1"
        assert all(line.code != "grade_cap" for line in outcome.lines)

    def test_cap_that_does_not_bite_leaves_no_cap_line(self) -> None:
        outcome = adjust_grade("C2", context(country_category=7))
        assert outcome.grade == "C2"
        assert [line.code for line in outcome.lines] == ["sector_adjustment", "country_adjustment"]
        assert outcome.lines[-1].cap_grade == "C1"  # configured, but did not bite

    def test_cap_applies_after_the_notch(self) -> None:
        outcome = adjust_grade("B2", context(sector_grade="A", country_category=6))
        assert [line.code for line in outcome.lines][-1] == "grade_cap"
        assert outcome.lines[-1].from_grade == "B1"
        assert outcome.grade == "C1"

    def test_the_worst_cap_wins(self) -> None:
        table = {
            "sector": {"B": {"notch": 0, "cap_grade": "B2"}},
            "country": {"6": {"notch": 0, "cap_grade": "C1"}},
        }
        outcome = adjust_grade("A1", context(country_category=6, adjustments=table))
        assert outcome.grade == "C1"
        assert outcome.lines[-1].cap_sources == ["country"]

    def test_equal_caps_name_both_sources(self) -> None:
        table = {
            "sector": {"B": {"cap_grade": "B1"}},
            "country": {"3": {"cap_grade": "B1"}},
        }
        outcome = adjust_grade("A1", context(adjustments=table))
        assert outcome.grade == "B1"
        assert outcome.lines[-1].cap_sources == ["sector", "country"]


class TestUnclassified:
    def test_unclassified_is_not_category_0(self) -> None:
        table = {"country": {"0": {"notch": 1}, "unclassified": {"notch": -1}}}
        zero = adjust_grade("B2", context(sector_grade=None, country_category=0, adjustments=table))
        unclassified = adjust_grade(
            "B2",
            context(
                sector_grade=None,
                country_category=None,
                country_classified=False,
                country_source=None,
                adjustments=table,
            ),
        )
        assert zero.grade == "B1"
        assert unclassified.grade == "C1"
        assert zero.lines[0].country_key == "0"
        assert zero.lines[0].country_category == 0
        assert unclassified.lines[0].country_key == "unclassified"
        assert unclassified.lines[0].country_category is None
        assert unclassified.lines[0].country_classified is False

    def test_category_without_classified_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            context(country_category=0, country_classified=False)

    def test_classified_without_category_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            context(country_category=None, country_classified=True)

    def test_classified_is_inferred_when_omitted(self) -> None:
        assert RiskContext.model_validate({"country_category": 0}).country_classified is True
        none = RiskContext.model_validate({})
        assert none.country_classified is False
        assert none.country_key == "unclassified"

    @pytest.mark.parametrize(
        "bad",
        [
            {"sector_grade": "E"},
            {"country_category": 8},
            {"country_category": -1},
            {"country_source": "imf"},
            {"adjustments": {"sector": {"E": {"notch": 1}}}},
            {"adjustments": {"country": {"8": {"notch": 1}}}},
            {"adjustments": {"country": {"6": {"cap_grade": "C3"}}}},
        ],
    )
    def test_invalid_contexts_are_refused(self, bad: dict[str, Any]) -> None:
        with pytest.raises(ValidationError):
            context(**bad)


class TestLimitFollowsTheAdjustedGrade:
    def test_upgrade_raises_the_limit(self, healthy_company: CompanyFinancials) -> None:
        plain = assess(healthy_company)
        result = assess(healthy_company, risk_context=context(sector_grade="A"))
        assert result.rating.effective_score is not None
        assert grade_for(result.rating.effective_score).code == "B1"
        assert result.limit.models[0].components["risk_coefficient"] == 1.0
        assert result.limit == calculate_limit(
            result.rating.effective_score, latest_ratios(healthy_company), "USD", 1.0
        )
        assert result.limit.recommended_limit > plain.limit.recommended_limit

    def test_downgrade_lowers_the_limit(self, healthy_company: CompanyFinancials) -> None:
        plain = assess(healthy_company)
        result = assess(healthy_company, risk_context=context(sector_grade="C"))
        assert result.rating.grade == "C1"
        assert result.limit.models[0].components["risk_coefficient"] == 0.4
        assert result.limit.recommended_limit < plain.limit.recommended_limit

    def test_capped_grade_drives_the_limit(self, healthy_company: CompanyFinancials) -> None:
        result = assess(healthy_company, risk_context=context(country_category=7))
        assert result.rating.grade == "C1"
        assert result.rating.effective_score is not None
        assert grade_for(result.rating.effective_score).code == "C1"
        assert result.limit.models[0].components["risk_coefficient"] == 0.4

    def test_down_to_d_means_no_limit(self, healthy_company: CompanyFinancials) -> None:
        table = {"sector": {"D": {"notch": -4}}}
        result = assess(healthy_company, risk_context=context(sector_grade="D", adjustments=table))
        assert result.rating.grade == "D"
        assert result.limit.recommended_limit == 0.0

    def test_hard_zero_rules_still_apply(self, distressed_company: CompanyFinancials) -> None:
        result = assess(distressed_company, risk_context=context(sector_grade="A"))
        assert result.rating.base_grade == "D"
        assert result.rating.grade == "C2"
        assert result.limit.recommended_limit == 0.0  # negative equity

    def test_effective_score_keeps_the_relative_position(self) -> None:
        # 42.7 in B2 (40, 55] -> 18% of the way -> B1 (25, 40] at 27.7
        assert effective_score(42.7, "B2", "B1") == 27.7
        assert effective_score(42.7, "B2", "B2") == 42.7
        assert effective_score(55.0, "B2", "A1") == 10.0

    def test_effective_score_is_always_in_the_target_band(self) -> None:
        for band_index, band in enumerate(GRADE_BANDS):
            lower = 0.0 if band_index == 0 else GRADE_BANDS[band_index - 1].upper
            score = round(max(1.0, lower + 0.1), 1)
            while score <= band.upper:
                for target in SCALE:
                    placed = effective_score(score, band.code, target)
                    assert grade_for(placed).code == target, (score, band.code, target)
                score = round(score + 0.1, 1)


class TestTraceAndSnapshot:
    def test_trace_lines(self, healthy_company: CompanyFinancials) -> None:
        result = assess(
            healthy_company, risk_context=context(sector_grade="A", country_category=6)
        )
        lines = [line.model_dump() for line in result.rating.risk_adjustments or []]
        assert lines == [
            {
                "code": "sector_adjustment",
                "sector_grade": "A",
                "notch": 1,
                "cap_grade": None,
                "from_grade": "B2",
                "to_grade": "B1",
            },
            {
                "code": "country_adjustment",
                "country_category": 6,
                "country_key": "6",
                "country_classified": True,
                "country_source": "oecd",
                "notch": 0,
                "cap_grade": "C1",
                "from_grade": "B1",
                "to_grade": "B1",
            },
            {
                "code": "grade_cap",
                "cap_grade": "C1",
                "cap_sources": ["country"],
                "from_grade": "B1",
                "to_grade": "C1",
            },
        ]

    def test_context_is_echoed(self, healthy_company: CompanyFinancials) -> None:
        used = context(sector_grade="C", country_source="internal")
        rating = assess(healthy_company, risk_context=used).model_dump(mode="json")["rating"]
        assert rating["risk_context"] == used.model_dump(mode="json")
        assert rating["risk_context"]["country_source"] == "internal"
        assert rating["base_grade"] == "B2"
        assert rating["grade"] == "C1"

    def test_unrated_echoes_the_context_without_lines(self) -> None:
        unrated = RatingResult(
            score=None,
            grade=None,
            grade_label_key=None,
            factors=[],
            adjustments=[],
            data_coverage=0.0,
            warnings=[],
        )
        result = apply_risk_context(unrated, context())
        assert result.grade is None
        dumped = result.model_dump()
        assert dumped["risk_context"] is not None
        assert dumped["risk_adjustments"] == []
        assert "base_grade" not in dumped

    def test_api_takes_the_context(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        used = context(sector_grade="A").model_dump(mode="json")
        response = client.post(
            "/v1/assess",
            json={"company": company_payload(), "narrative": False, "risk_context": used},
        )
        assert response.status_code == 200
        rating = response.json()["assessment"]["rating"]
        assert rating["base_grade"] == "B2"
        assert rating["grade"] == "B1"
        assert rating["risk_context"] == used
        assert [line["code"] for line in rating["risk_adjustments"]] == [
            "sector_adjustment",
            "country_adjustment",
        ]

    def test_api_refuses_an_unclassified_category_0(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        bad = {"country_category": 0, "country_classified": False}
        response = client.post(
            "/v1/assess",
            json={"company": company_payload(), "narrative": False, "risk_context": bad},
        )
        assert response.status_code == 422
        assert json.dumps(response.json())  # a readable validation error
