"""FastAPI service tests (TestClient, fake completer - no real API calls)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from credit_engine_api.app import create_app
from tests.test_narrative import FakeCompleter


def company_payload() -> dict[str, object]:
    period = {
        "year": 2025,
        "total_assets": 50_000_000,
        "non_current_assets": 20_000_000,
        "intangible_assets": 1_000_000,
        "inventories": 8_000_000,
        "accounts_receivable": 10_000_000,
        "cash": 5_000_000,
        "current_assets": 30_000_000,
        "equity": 25_000_000,
        "long_term_debt": 10_000_000,
        "short_term_debt": 5_000_000,
        "accounts_payable": 6_000_000,
        "current_liabilities": 15_000_000,
        "revenue": 80_000_000,
        "cost_of_sales": -60_000_000,
        "operating_profit": 13_000_000,
        "interest_expenses": -1_500_000,
        "profit_before_tax": 11_600_000,
        "net_profit": 9_000_000,
    }
    return {
        "name": "API Test LLC",
        "age_years": 10,
        "currency": "USD",
        "exchange_rate_usd": 1.0,
        "periods": [{**period, "year": 2024, "revenue": 70_000_000}, period],
    }


class EchoCompleter:
    """Returns the draft unchanged - always passes number validation."""

    async def complete(self, *, system: str, user: str) -> str:
        draft_json = user.split("DRAFT (English):\n", 1)[1]
        draft = json.loads(draft_json.split("\n\nYour previous reply")[0])
        return json.dumps({k: v + " (ai)" for k, v in draft.items()})


class TestHealth:
    def test_health_reports_narrative_state(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert body["narrative_configured"] is False

        client_ai = TestClient(create_app(completer=EchoCompleter(), api_key=""))
        assert client_ai.get("/health").json()["narrative_configured"] is True


class TestAssessEndpoint:
    def test_full_flow_with_narrative(self) -> None:
        client = TestClient(create_app(completer=EchoCompleter(), api_key=""))
        response = client.post(
            "/v1/assess",
            json={"company": company_payload(), "language": "ru"},
        )
        assert response.status_code == 200
        body = response.json()

        assessment = body["assessment"]
        assert assessment["rating"]["score"] is not None
        assert assessment["rating"]["grade"]
        assert assessment["limit"]["recommended_limit"] > 0
        assert assessment["rating"]["factors"]
        assert assessment["findings"]

        narrative = body["narrative"]
        assert narrative["status"] == "ok"
        assert narrative["language"] == "ru"
        assert all(v.endswith("(ai)") for v in narrative["sections"].values())

    def test_narrative_skipped_on_request(self) -> None:
        client = TestClient(create_app(completer=EchoCompleter(), api_key=""))
        body = client.post(
            "/v1/assess",
            json={"company": company_payload(), "narrative": False},
        ).json()
        assert body["narrative"]["status"] == "skipped"
        assert body["assessment"]["rating"]["score"] is not None

    def test_ai_down_still_returns_assessment(self) -> None:
        """The hard requirement: AI failure never blocks rating/limit."""
        failing = FakeCompleter([ConnectionError("down"), ConnectionError("down")])
        client = TestClient(create_app(completer=failing, api_key=""))
        response = client.post("/v1/assess", json={"company": company_payload()})

        assert response.status_code == 200
        body = response.json()
        assert body["narrative"]["status"] == "unavailable"
        assert body["narrative"]["message_key"] == "commentary.service_unavailable"
        assert body["assessment"]["rating"]["score"] is not None
        assert body["assessment"]["limit"]["recommended_limit"] > 0
        assert body["assessment"]["findings"]

    def test_no_completer_configured_is_unavailable(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        body = client.post("/v1/assess", json={"company": company_payload()}).json()
        assert body["narrative"]["status"] == "unavailable"

    def test_invalid_payload_is_422(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        response = client.post("/v1/assess", json={"company": {"periods": []}})
        assert response.status_code == 422

    def test_negative_exchange_rate_rejected(self) -> None:
        client = TestClient(create_app(completer=None, api_key=""))
        payload = company_payload()
        payload["exchange_rate_usd"] = -5
        response = client.post("/v1/assess", json={"company": payload})
        assert response.status_code == 422


class TestApiKey:
    def test_key_required_when_configured(self) -> None:
        client = TestClient(create_app(completer=None, api_key="secret-key"))

        denied = client.post("/v1/assess", json={"company": company_payload()})
        assert denied.status_code == 401

        wrong = client.post(
            "/v1/assess",
            json={"company": company_payload()},
            headers={"X-API-Key": "nope"},
        )
        assert wrong.status_code == 401

        allowed = client.post(
            "/v1/assess",
            json={"company": company_payload()},
            headers={"X-API-Key": "secret-key"},
        )
        assert allowed.status_code == 200

    def test_health_is_open(self) -> None:
        client = TestClient(create_app(completer=None, api_key="secret-key"))
        assert client.get("/health").status_code == 200
