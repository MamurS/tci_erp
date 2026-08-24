"""AI narrative layer tests (fake completer - no real API calls)."""

from __future__ import annotations

import json

import pytest

from credit_engine import assess
from credit_engine.narrative import (
    NarrativeConfig,
    NarrativeUnavailableError,
    narrate,
    validate_numbers,
)


class FakeCompleter:
    """Scripted completer: returns queued replies, records prompts."""

    def __init__(self, replies: list[str | Exception]):
        self.replies = list(replies)
        self.calls: list[dict[str, str]] = []

    async def complete(self, *, system: str, user: str) -> str:
        self.calls.append({"system": system, "user": user})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def polished_reply(draft: dict[str, str], suffix: str = " (polished)") -> str:
    """A valid reply: the draft itself, lightly marked - all numbers legal."""
    return json.dumps({k: v + suffix for k, v in draft.items()})


class TestValidateNumbers:
    def test_accepts_numbers_from_sources(self) -> None:
        assert validate_numbers("Revenue was 510.0B, up 21.4%", "revenue 510 21.4 0") == []

    def test_locale_reformatting_is_tolerated(self) -> None:
        # "21,4 %" and "21.4%" carry the same digit runs
        assert validate_numbers("выручка выросла на 21,4 %", "grew by 21.4%") == []

    def test_invented_number_is_caught(self) -> None:
        violations = validate_numbers("EBITDA reached 999 million", "revenue 510")
        assert violations == ["999"]

    def test_single_digits_are_allowed(self) -> None:
        assert validate_numbers("in 3 words", "no numbers here") == []


class TestNarrate:
    async def test_happy_path(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        fake = FakeCompleter([polished_reply(assessment.commentary)])

        sections = await narrate(assessment, "ru", fake)

        assert set(sections) == set(assessment.commentary)
        assert all(v.endswith("(polished)") for v in sections.values())
        # the prompt carries the target language, facts and draft
        assert "Russian" in fake.calls[0]["system"]
        assert "FACT SHEET" in fake.calls[0]["user"]
        assert "DRAFT" in fake.calls[0]["user"]

    async def test_hallucinated_number_retries_then_fails(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        bad = json.dumps(dict.fromkeys(assessment.commentary, "Revenue soared to 987654321 USD."))
        fake = FakeCompleter([bad, bad])

        with pytest.raises(NarrativeUnavailableError):
            await narrate(assessment, "en", fake)
        assert len(fake.calls) == 2  # one retry happened
        assert "rejected" in fake.calls[1]["user"]

    async def test_retry_can_recover(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        fake = FakeCompleter(["not json at all", polished_reply(assessment.commentary)])

        sections = await narrate(assessment, "uz", fake)
        assert set(sections) == set(assessment.commentary)

    async def test_api_error_means_unavailable(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        fake = FakeCompleter([ConnectionError("api down"), ConnectionError("api down")])

        with pytest.raises(NarrativeUnavailableError) as excinfo:
            await narrate(assessment, "ru", fake)
        assert excinfo.value.message_key == "commentary.service_unavailable"

    async def test_missing_section_rejected(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        incomplete = json.dumps({"income_statement": "only one section"})
        fake = FakeCompleter([incomplete, incomplete])

        with pytest.raises(NarrativeUnavailableError):
            await narrate(assessment, "en", fake)

    async def test_json_inside_fences_is_parsed(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        assessment = assess(healthy_company)
        wrapped = "Here you go:\n```json\n" + polished_reply(assessment.commentary) + "\n```"
        fake = FakeCompleter([wrapped])

        sections = await narrate(assessment, "en", fake)
        assert set(sections) == set(assessment.commentary)

    async def test_assessment_survives_narrative_failure(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        """Rating/limit/findings are independent of the AI layer."""
        assessment = assess(healthy_company)
        fake = FakeCompleter([ConnectionError("down"), ConnectionError("down")])
        with pytest.raises(NarrativeUnavailableError):
            await narrate(assessment, "ru", fake, NarrativeConfig(max_attempts=2))

        assert assessment.rating.score is not None
        assert assessment.limit.recommended_limit > 0
        assert assessment.findings
