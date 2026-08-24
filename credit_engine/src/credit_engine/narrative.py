"""AI narrative layer: polish + translate the commentary via the Claude API.

Design (replaces the legacy "template scraps -> GPT rewrite" pipeline):

* The deterministic engine produces a structured FACT SHEET and an English
  DRAFT (`CreditAssessment.commentary`). They are the only source of truth.
* One Claude call per report rewrites the draft as a professional credit
  analyst would - and renders it directly in the target language. Polishing
  and translation in a single step avoids meaning drift and halves cost.
* Anti-hallucination guardrail is programmatic, not hopeful: every digit
  sequence in the model output must already exist in the fact sheet or
  draft. A violation triggers one retry; a second failure raises.
* Availability policy: ANY failure (API down, bad JSON, failed validation)
  raises `NarrativeUnavailableError`. The caller shows "service
  unavailable, try later" for the narrative while the rating, limit and
  structured justification render as usual - they never depend on the AI.

The Claude client is injected via a one-method protocol, so tests run with
a fake and the provider can later be swapped for an open-source model.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Protocol

from credit_engine.models import CreditAssessment

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ru": "Russian",
    "uz": "Uzbek (Latin script)",
}


class NarrativeUnavailableError(Exception):
    """The narrative service failed; show 'service unavailable, try later'.

    The structured assessment (rating, limit, findings) is unaffected.
    """

    message_key = "commentary.service_unavailable"


class Completer(Protocol):
    """Minimal LLM interface; implement it to swap providers."""

    async def complete(self, *, system: str, user: str) -> str: ...


@dataclass(frozen=True)
class NarrativeConfig:
    """Claude API settings.

    Note: temperature is intentionally absent - sampling parameters are
    removed on Claude 5 family models (a request with them returns 400).
    Natural stylistic variation between reports comes from the model itself.
    """

    model: str = "claude-opus-5"
    max_tokens: int = 3000
    max_attempts: int = 2


class AnthropicCompleter:
    """Claude API adapter. Requires the `anthropic` package (extra: `ai`)."""

    def __init__(self, api_key: str | None = None, config: NarrativeConfig | None = None):
        import anthropic  # deferred so the core library works without it

        self._config = config or NarrativeConfig()
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def complete(self, *, system: str, user: str) -> str:
        response = await self._client.messages.create(
            model=self._config.model,
            max_tokens=self._config.max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts = [block.text for block in response.content if block.type == "text"]
        return "".join(parts)


SYSTEM_PROMPT = """\
You are a senior credit analyst at a trade credit insurance company writing
the narrative sections of a credit report on a buyer (debtor company).

Rules, in order of priority:
1. FACTS ARE FIXED. Every number, percentage, ratio, amount, grade and
   conclusion must come from the FACT SHEET / DRAFT provided. Never invent,
   recompute, extrapolate or round differently. Keep every digit sequence
   exactly as given (you may adapt thousand/decimal separators to the
   target language, but never change the digits themselves).
2. Do not add facts that are not present (no industry context, no market
   commentary, no assumptions about management or products).
3. Write in {language}. Use the professional register of an experienced
   underwriter: varied sentence structure, natural flow, no template feel.
   Do not translate the currency code.
4. Keep each section roughly the length of its draft (at most ~40% longer).
5. Return ONLY a JSON object with exactly these keys: {keys}.
   Values are plain text paragraphs (no markdown).
"""


def _fact_sheet(assessment: CreditAssessment) -> dict[str, object]:
    """Compact structured facts given to the model alongside the draft."""
    latest = assessment.ratio_reports[-1]
    return {
        "company": assessment.company_name,
        "assessed_year": assessment.assessed_year,
        "currency": assessment.currency,
        "rating_score_1_to_100_lower_is_better": assessment.rating.score,
        "grade": assessment.rating.grade,
        "data_coverage": assessment.rating.data_coverage,
        "recommended_credit_limit": assessment.limit.recommended_limit,
        "limit_reasons": assessment.limit.reasons,
        "adjustments": [
            {"rule": a.code, "detail": a.detail} for a in assessment.rating.adjustments
        ],
        "key_ratios": {k: v for k, v in latest.ratios.items() if v is not None},
        "dynamics_vs_previous_year": {
            k: v for k, v in latest.dynamics.items() if v is not None
        },
    }


_DIGIT_RUN = re.compile(r"\d+")


def _digit_runs(text: str) -> set[str]:
    return set(_DIGIT_RUN.findall(text))


def validate_numbers(output_text: str, *allowed_sources: str) -> list[str]:
    """Digit sequences in the output that appear in no source text.

    Splitting on non-digits makes the check robust to locale formatting
    ("21.4%" vs "21,4 %" both yield {"21", "4"}). Single digits are allowed
    (enumeration, "1-100 scale" style artifacts).
    """
    allowed: set[str] = set()
    for source in allowed_sources:
        allowed |= _digit_runs(source)
    return [run for run in _digit_runs(output_text) if len(run) >= 2 and run not in allowed]


def _parse_sections(raw: str, expected_keys: list[str]) -> dict[str, str]:
    """Parse the model's JSON reply; tolerate surrounding prose/fences."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("no JSON object in model output")
    data = json.loads(match.group())
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    sections: dict[str, str] = {}
    for key in expected_keys:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"missing or empty section: {key}")
        sections[key] = value.strip()
    return sections


async def narrate(
    assessment: CreditAssessment,
    language: str,
    completer: Completer,
    config: NarrativeConfig | None = None,
) -> dict[str, str]:
    """Produce polished commentary in `language` from the draft + facts.

    Returns sections keyed like `assessment.commentary`. Raises
    `NarrativeUnavailableError` on any failure - the caller must then show
    the service-unavailable message instead of narrative text, while still
    rendering the rating, limit and structured findings.
    """
    config = config or NarrativeConfig()
    draft = assessment.commentary
    keys = list(draft.keys())
    facts_json = json.dumps(_fact_sheet(assessment), ensure_ascii=False, default=str)
    draft_json = json.dumps(draft, ensure_ascii=False)

    system = SYSTEM_PROMPT.format(
        language=LANGUAGE_NAMES.get(language, language),
        keys=json.dumps(keys),
    )
    user = f"FACT SHEET:\n{facts_json}\n\nDRAFT (English):\n{draft_json}"

    last_error: Exception | None = None
    for attempt in range(config.max_attempts):
        try:
            raw = await completer.complete(system=system, user=user)
            sections = _parse_sections(raw, keys)
            violations = validate_numbers(" ".join(sections.values()), facts_json, draft_json)
            if violations:
                raise ValueError(f"numbers not present in the facts: {violations}")
            return sections
        except Exception as exc:  # noqa: BLE001 - any failure means "unavailable"
            last_error = exc
            if attempt + 1 < config.max_attempts:
                user = (
                    f"{user}\n\nYour previous reply was rejected "
                    f"({exc}). Follow the rules strictly and reply with JSON only."
                )
    raise NarrativeUnavailableError(str(last_error)) from last_error
