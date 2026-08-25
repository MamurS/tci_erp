"""FX proxy endpoint tests (CBU API mocked - no network)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

import app.fx as fx_module
from app.main import app

client = TestClient(app)


class MockAsyncClient:
    """Substitute for httpx.AsyncClient returning a scripted payload."""

    payload: object = []
    error: Exception | None = None

    def __init__(self, *args: object, **kwargs: object) -> None: ...

    async def __aenter__(self) -> "MockAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> None: ...

    async def get(self, url: str) -> httpx.Response:
        if MockAsyncClient.error:
            raise MockAsyncClient.error
        request = httpx.Request("GET", url)
        return httpx.Response(200, json=MockAsyncClient.payload, request=request)


@pytest.fixture(autouse=True)
def mock_httpx(monkeypatch: pytest.MonkeyPatch):
    MockAsyncClient.payload = []
    MockAsyncClient.error = None
    monkeypatch.setattr(fx_module.httpx, "AsyncClient", MockAsyncClient)


def test_fx_happy_path() -> None:
    MockAsyncClient.payload = [
        {"Ccy": "USD", "Rate": "12345.67", "Nominal": "1", "Date": "31.12.2025"}
    ]
    body = client.get("/fx", params={"ccy": "usd", "date": "2025-12-31"}).json()
    assert body == {
        "ccy": "USD",
        "date": "2025-12-31",
        "rate_to_uzs": 12345.67,
        "source": "cbu",
    }


def test_fx_respects_nominal() -> None:
    # Some currencies are quoted per 10/100 units.
    MockAsyncClient.payload = [{"Ccy": "JPY", "Rate": "800.50", "Nominal": "10"}]
    body = client.get("/fx", params={"ccy": "JPY", "date": "2025-12-31"}).json()
    assert body["rate_to_uzs"] == pytest.approx(80.05)


def test_fx_unknown_currency_404() -> None:
    MockAsyncClient.payload = []
    response = client.get("/fx", params={"ccy": "XXX", "date": "2025-12-31"})
    assert response.status_code == 404


def test_fx_cbu_down_502() -> None:
    MockAsyncClient.error = httpx.ConnectError("boom")
    response = client.get("/fx", params={"ccy": "USD", "date": "2025-12-31"})
    assert response.status_code == 502


def test_fx_validation() -> None:
    assert client.get("/fx", params={"ccy": "US", "date": "2025-12-31"}).status_code == 422
    assert client.get("/fx", params={"ccy": "USD", "date": "31.12.2025"}).status_code == 422
