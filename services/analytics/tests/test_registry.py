"""Registry connector tests (GLEIF and Companies House mocked — no network)."""

from __future__ import annotations

import logging

import httpx
import pytest
from fastapi.testclient import TestClient

import app.registry as registry
from app.main import app

client = TestClient(app)

GLEIF_PAYLOAD = {
    "data": [
        {
            "id": "529900T8BM49AURSDO55",
            "attributes": {
                "lei": "529900T8BM49AURSDO55",
                "entity": {
                    "legalName": {"name": "Delcreda Trade GmbH"},
                    "legalAddress": {
                        "addressLines": ["Hauptstrasse 1"],
                        "city": "Berlin",
                        "postalCode": "10115",
                        "country": "DE",
                    },
                    "registeredAs": "HRB 12345",
                    "legalForm": {"id": "2HBR"},
                    "status": "ACTIVE",
                    "creationDate": "2004-06-01T00:00:00Z",
                },
            },
        },
        {"id": "no-name", "attributes": {"entity": {"legalName": {"name": ""}}}},
    ]
}

CH_PAYLOAD = {
    "items": [
        {
            "title": "DELCREDA UK LIMITED",
            "company_number": "01234567",
            "address_snippet": "1 King Street, London, EC2V 8AU",
            "company_status": "active",
            "company_type": "ltd",
            "date_of_creation": "1999-03-04",
        },
        {"title": "", "company_number": "x"},
    ]
}


class MockAsyncClient:
    payload: object = {}
    error: Exception | None = None
    calls: list[dict[str, object]] = []

    def __init__(self, *args: object, **kwargs: object) -> None: ...

    async def __aenter__(self) -> "MockAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> None: ...

    async def get(self, url: str, **kwargs: object) -> httpx.Response:
        MockAsyncClient.calls.append({"url": url, **kwargs})
        if MockAsyncClient.error:
            raise MockAsyncClient.error
        return httpx.Response(200, json=MockAsyncClient.payload, request=httpx.Request("GET", url))


@pytest.fixture(autouse=True)
def mock_httpx(monkeypatch: pytest.MonkeyPatch):
    MockAsyncClient.payload = {}
    MockAsyncClient.error = None
    MockAsyncClient.calls = []
    monkeypatch.setattr(registry.httpx, "AsyncClient", MockAsyncClient)
    monkeypatch.delenv("COMPANIES_HOUSE_API_KEY", raising=False)


def test_sources_list_companies_house_only_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    body = client.get("/registry/sources").json()
    assert body == [
        {"source": "gleif", "countries": None, "available": True},
        {"source": "companies_house", "countries": ["GB"], "available": False},
    ]
    monkeypatch.setenv("COMPANIES_HOUSE_API_KEY", "k")
    assert client.get("/registry/sources").json()[1]["available"] is True


def test_gleif_record_is_normalised_and_nameless_rows_dropped() -> None:
    MockAsyncClient.payload = GLEIF_PAYLOAD
    body = client.get("/registry/search", params={"source": "gleif", "q": "Delcreda", "country": "de"}).json()
    assert body["source"] == "gleif"
    assert body["records"] == [
        {
            "source": "gleif",
            "source_id": "529900T8BM49AURSDO55",
            "name": "Delcreda Trade GmbH",
            "country_code": "DE",
            "registration_number": "HRB 12345",
            "address": "Hauptstrasse 1, 10115, Berlin",
            "legal_form": "2HBR",
            "status": "ACTIVE",
            "founded_date": "2004-06-01",
            "url": "https://search.gleif.org/#/record/529900T8BM49AURSDO55",
        }
    ]
    params = MockAsyncClient.calls[0]["params"]
    assert params["filter[fulltext]"] == "Delcreda"
    assert params["filter[entity.legalAddress.country]"] == "DE"


def test_companies_house_needs_its_key_and_sends_it_as_basic_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    MockAsyncClient.payload = CH_PAYLOAD
    assert client.get("/registry/search", params={"source": "companies_house", "q": "Delcreda"}).status_code == 503

    monkeypatch.setenv("COMPANIES_HOUSE_API_KEY", "secret-key")
    body = client.get("/registry/search", params={"source": "companies_house", "q": "Delcreda"}).json()
    assert [r["registration_number"] for r in body["records"]] == ["01234567"]
    assert body["records"][0]["country_code"] == "GB"
    assert body["records"][0]["founded_date"] == "1999-03-04"
    assert MockAsyncClient.calls[-1]["auth"] == ("secret-key", "")


def test_upstream_failure_is_opaque_and_the_key_is_never_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("COMPANIES_HOUSE_API_KEY", "secret-key")
    MockAsyncClient.error = httpx.ConnectError("boom https://x?key=secret-key")
    with caplog.at_level(logging.WARNING):
        response = client.get("/registry/search", params={"source": "companies_house", "q": "Delcreda"})
    assert response.status_code == 502
    assert response.json() == {"detail": "Companies House unavailable"}
    assert "secret-key" not in caplog.text

    MockAsyncClient.error = httpx.ReadTimeout("slow")
    response = client.get("/registry/search", params={"source": "gleif", "q": "Delcreda"})
    assert response.status_code == 502
    assert response.json() == {"detail": "GLEIF unavailable"}


@pytest.mark.parametrize(
    "params",
    [
        {"source": "gleif", "q": "ab"},
        {"source": "gleif", "q": "x" * 121},
        {"source": "gleif", "q": "Delcreda", "country": "DEU"},
        {"source": "dadata", "q": "Delcreda"},
    ],
)
def test_bad_input_is_refused(params: dict[str, str]) -> None:
    assert client.get("/registry/search", params=params).status_code == 422
    assert MockAsyncClient.calls == []
