"""/rating and /credit-limit with a risk context (sector grade + country category)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from credit_engine import __version__ as engine_version
from credit_engine.scoring.tables import grade_for

from app.main import app
from tests.test_service import payload, period

client = TestClient(app)
GOLDEN = Path(__file__).parent / "golden"

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


def risk_context(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "sector_grade": "B",
        "country_category": 3,
        "country_classified": True,
        "country_source": "oecd",
        "adjustments": DEFAULT_ADJUSTMENTS,
    }
    data.update(overrides)
    return data


def golden(name: str) -> bytes:
    text = (GOLDEN / name).read_text().replace("__ENGINE_VERSION__", engine_version)
    return text.encode()


CASES = {
    "healthy": payload(),
    "loss": payload(
        periods=[period(2024), period(2025, net_profit=-50_000_000, total_equity=-5_000_000)]
    ),
}

RISK_KEYS = ("base_grade", "effective_score", "risk_context", "risk_adjustments")


class TestNoContextRegression:
    """Without a risk context both endpoints answer byte-for-byte as before
    (only engine_version moves with the release)."""

    @pytest.mark.parametrize("name", CASES)
    def test_rating(self, name: str) -> None:
        response = client.post("/rating", json=CASES[name])
        assert response.status_code == 200
        assert response.content + b"\n" == golden(f"rating_{name}.json")

    @pytest.mark.parametrize("name", CASES)
    def test_credit_limit(self, name: str) -> None:
        score = client.post("/rating", json=CASES[name]).json()["score"]
        response = client.post("/credit-limit", json={**CASES[name], "rating_score": score})
        assert response.status_code == 200
        assert response.content + b"\n" == golden(f"credit_limit_{name}.json")

    def test_engine_version_is_the_bumped_one(self) -> None:
        assert engine_version == "0.2.0"
        assert client.get("/health").json()["engine_version"] == "0.2.0"


class TestRating:
    def test_neutral_context_keeps_the_grade(self) -> None:
        plain = client.post("/rating", json=payload()).json()
        body = client.post("/rating", json=payload(risk_context=risk_context())).json()
        assert body["grade"] == plain["grade"] == "B2"
        assert body["base_grade"] == "B2"
        assert body["score"] == plain["score"]
        assert body["effective_score"] == plain["score"]
        assert [line["code"] for line in body["risk_adjustments"]] == [
            "sector_adjustment",
            "country_adjustment",
        ]
        assert body["risk_adjustments"][0]["notch"] == 0  # "sector B, no change"

    def test_sector_a_notches_up(self) -> None:
        body = client.post("/rating", json=payload(risk_context=risk_context(sector_grade="A")))
        rating = body.json()
        assert rating["base_grade"] == "B2"
        assert rating["grade"] == "B1"
        assert rating["grade_label_key"] == "grade.good"
        assert grade_for(rating["effective_score"]).code == "B1"

    def test_sector_d_notches_down(self) -> None:
        body = client.post("/rating", json=payload(risk_context=risk_context(sector_grade="D")))
        assert body.json()["grade"] == "C2"

    def test_country_7_caps_at_c1(self) -> None:
        body = client.post(
            "/rating", json=payload(risk_context=risk_context(sector_grade="A", country_category=7))
        ).json()
        assert body["grade"] == "C1"
        assert body["risk_adjustments"][-1] == {
            "code": "grade_cap",
            "cap_grade": "C1",
            "cap_sources": ["country"],
            "from_grade": "B1",
            "to_grade": "C1",
        }

    def test_unclassified_is_its_own_row(self) -> None:
        table = {"country": {"0": {"notch": 1}, "unclassified": {"notch": -1}}}
        unclassified = risk_context(
            sector_grade=None,
            country_category=None,
            country_classified=False,
            country_source=None,
            adjustments=table,
        )
        zero = risk_context(sector_grade=None, country_category=0, adjustments=table)
        a = client.post("/rating", json=payload(risk_context=unclassified)).json()
        b = client.post("/rating", json=payload(risk_context=zero)).json()
        assert a["grade"] == "C1"
        assert b["grade"] == "B1"
        assert a["risk_adjustments"][0]["country_key"] == "unclassified"
        assert a["risk_adjustments"][0]["country_category"] is None

    def test_unclassified_category_0_is_refused(self) -> None:
        bad = risk_context(country_category=0, country_classified=False)
        assert client.post("/rating", json=payload(risk_context=bad)).status_code == 422

    def test_unknown_cap_grade_is_refused(self) -> None:
        bad = risk_context(adjustments={"country": {"6": {"cap_grade": "Z9"}}})
        assert client.post("/rating", json=payload(risk_context=bad)).status_code == 422

    def test_context_is_echoed(self) -> None:
        used = risk_context(sector_grade="C", country_source="internal")
        body = client.post("/rating", json=payload(risk_context=used)).json()
        assert body["risk_context"] == used

    def test_no_risk_keys_without_context(self) -> None:
        body = client.post("/rating", json=payload()).json()
        for key in RISK_KEYS:
            assert key not in body


class TestCreditLimit:
    def limit(self, context: dict[str, Any] | None) -> dict[str, Any]:
        base = payload() if context is None else payload(risk_context=context)
        score = client.post("/rating", json=base).json()["score"]
        response = client.post("/credit-limit", json={**base, "rating_score": score})
        assert response.status_code == 200
        body: dict[str, Any] = response.json()
        return body

    def test_neutral_context_keeps_the_limit(self) -> None:
        plain = self.limit(None)
        body = self.limit(risk_context())
        assert body["suggested_limit"] == plain["suggested_limit"]
        assert body["base_grade"] == body["grade"] == "B2"

    def test_upgrade_raises_the_limit(self) -> None:
        plain = self.limit(None)
        body = self.limit(risk_context(sector_grade="A"))
        assert body["grade"] == "B1"
        assert body["trace"][0]["components"]["risk_coefficient"] == 1.0
        assert body["suggested_limit"] > plain["suggested_limit"]

    def test_downgrade_lowers_the_limit(self) -> None:
        plain = self.limit(None)
        body = self.limit(risk_context(sector_grade="C"))
        assert body["grade"] == "C1"
        assert body["trace"][0]["components"]["risk_coefficient"] == 0.4
        assert body["suggested_limit"] < plain["suggested_limit"]

    def test_cap_drives_the_limit(self) -> None:
        body = self.limit(risk_context(country_category=6))
        assert body["grade"] == "C1"
        assert grade_for(body["effective_score"]).code == "C1"
        assert body["trace"][0]["components"]["risk_coefficient"] == 0.4

    def test_limit_matches_the_rating_endpoint(self) -> None:
        used = risk_context(sector_grade="D", country_category=7)
        rating = client.post("/rating", json=payload(risk_context=used)).json()
        body = self.limit(used)
        assert body["grade"] == rating["grade"]
        assert body["effective_score"] == rating["effective_score"]
        assert body["risk_adjustments"] == rating["risk_adjustments"]
        assert body["risk_context"] == used

    def test_no_risk_keys_without_context(self) -> None:
        body = self.limit(None)
        for key in (*RISK_KEYS, "grade"):
            assert key not in body
