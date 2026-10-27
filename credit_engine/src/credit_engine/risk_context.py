"""Sector grade and country risk category: the grade adjustment after the score.

After Allianz Trade practice, the grade a buyer's financials earn is moved by
the grade of the SECTOR it trades in and the risk CATEGORY of its country
(OECD scale 0..7, or an internal override). The engine does not know either
fact nor the size of the moves: the caller passes a `RiskContext` holding the
buyer's sector grade, its country category and the adjustment table.

The rule, applied after the score has been mapped to a grade (the score
itself never changes):

1. total notch = sector notch + country notch. The sector row is the one keyed
   by the sector grade (no sector grade => no sector line); the country row is
   keyed by ``str(category)`` when the country is classified and by
   ``"unclassified"`` when it is not - which is NOT category 0. A missing row
   means notch 0 and no cap. A positive notch is a BETTER grade.
2. The base grade moves ``total notch`` steps along the engine's own grade
   scale (`GRADE_BANDS`, best to worst), clamped at both ends.
3. Caps: every applicable rule with a ``cap_grade`` caps the grade - it can
   be no better than the WORST of those caps.

The credit limit follows the adjusted grade: `effective_score` places the
score inside the adjusted grade's band (keeping the relative position it had
in the base band) and the limit is computed on that, so the band's risk
coefficient, the equity-share bands and the "no credit" threshold all answer
for the adjusted grade. A grade that does not move keeps its score exactly.

Trace lines (`credit_engine.models`): ``sector_adjustment`` (when a sector
grade is given), ``country_adjustment`` (always), ``grade_cap`` (only when a
cap bites). The notch lines show the running position along the scale; the
notch is applied as one total, so the clamp at the ends is applied once, to
the total.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from credit_engine.models import (
    CountryAdjustmentLine,
    GradeCapLine,
    RatingResult,
    RiskAdjustmentLine,
    RiskAdjustmentRule,
    RiskContext,
    SectorAdjustmentLine,
)
from credit_engine.scoring.tables import GRADE_BANDS, GradeBandDef, grade_for

_NO_RULE = RiskAdjustmentRule()


def grade_scale() -> tuple[str, ...]:
    """The engine's grade codes, best to worst."""
    return tuple(band.code for band in GRADE_BANDS)


def _band_bounds(index: int) -> tuple[float, float]:
    """(exclusive lower, inclusive upper) score bounds of a band."""
    lower = 0.0 if index == 0 else GRADE_BANDS[index - 1].upper
    return lower, GRADE_BANDS[index].upper


def _clamp(position: int) -> int:
    return max(0, min(len(GRADE_BANDS) - 1, position))


@dataclass(frozen=True)
class GradeAdjustment:
    base_grade: str
    grade: str
    lines: list[RiskAdjustmentLine]


def adjust_grade(base_grade: str, context: RiskContext) -> GradeAdjustment:
    """Apply the sector and country rows of the context to a grade."""
    scale = grade_scale()
    if base_grade not in scale:
        raise ValueError(f"unknown grade {base_grade!r}")
    table = context.adjustments
    base = scale.index(base_grade)
    lines: list[RiskAdjustmentLine] = []
    caps: list[tuple[int, Literal["sector", "country"]]] = []

    # Positions grow towards WORSE grades; a positive notch is a better grade.
    position = base

    if context.sector_grade is not None:
        sector_rule = table.sector.get(context.sector_grade, _NO_RULE)
        before = position
        position -= sector_rule.notch
        lines.append(
            SectorAdjustmentLine(
                sector_grade=context.sector_grade,
                notch=sector_rule.notch,
                cap_grade=sector_rule.cap_grade,
                from_grade=scale[_clamp(before)],
                to_grade=scale[_clamp(position)],
            )
        )
        if sector_rule.cap_grade is not None:
            caps.append((scale.index(sector_rule.cap_grade), "sector"))

    country_rule = table.country.get(context.country_key, _NO_RULE)
    before = position
    position -= country_rule.notch
    lines.append(
        CountryAdjustmentLine(
            country_category=context.country_category,
            country_key=context.country_key,
            country_classified=context.country_classified,
            country_source=context.country_source,
            notch=country_rule.notch,
            cap_grade=country_rule.cap_grade,
            from_grade=scale[_clamp(before)],
            to_grade=scale[_clamp(position)],
        )
    )
    if country_rule.cap_grade is not None:
        caps.append((scale.index(country_rule.cap_grade), "country"))

    notched = _clamp(position)
    final = notched
    if caps:
        worst_cap = max(index for index, _ in caps)
        if notched < worst_cap:
            final = worst_cap
            lines.append(
                GradeCapLine(
                    cap_grade=scale[worst_cap],
                    cap_sources=[source for index, source in caps if index == worst_cap],
                    from_grade=scale[notched],
                    to_grade=scale[final],
                )
            )

    return GradeAdjustment(base_grade=base_grade, grade=scale[final], lines=lines)


def effective_score(score: float, base_grade: str, grade: str) -> float:
    """The score placed inside ``grade``'s band at the relative position it
    held in ``base_grade``'s band (1 decimal, like the score). Unchanged when
    the grade did not move; always inside the target band."""
    if base_grade == grade:
        return score
    scale = grade_scale()
    old_lower, old_upper = _band_bounds(scale.index(base_grade))
    new_lower, new_upper = _band_bounds(scale.index(grade))
    fraction = (score - old_lower) / (old_upper - old_lower)
    fraction = min(1.0, max(0.0, fraction))
    placed = round(new_lower + fraction * (new_upper - new_lower), 1)
    # Lower bounds are exclusive: never let rounding land on the better band.
    if placed <= new_lower:
        placed = round(new_lower + 0.1, 1)
    placed = min(placed, new_upper)
    if grade_for(placed).code != grade:  # pragma: no cover - the bounds above guarantee it
        raise RuntimeError(f"effective score {placed} is not in grade {grade}")
    return placed


def _band(code: str) -> GradeBandDef:
    return next(band for band in GRADE_BANDS if band.code == code)


def apply_risk_context(rating: RatingResult, context: RiskContext) -> RatingResult:
    """The rating with the risk context applied: ``grade`` adjusted, ``score``
    untouched, ``base_grade`` / ``effective_score`` / ``risk_context`` /
    ``risk_adjustments`` filled in. A rating that could not be computed is
    returned with the context echoed and no adjustment lines."""
    if rating.score is None or rating.grade is None:
        return rating.model_copy(update={"risk_context": context, "risk_adjustments": []})

    adjustment = adjust_grade(rating.grade, context)
    return rating.model_copy(
        update={
            "grade": adjustment.grade,
            "grade_label_key": _band(adjustment.grade).label_key,
            "base_grade": adjustment.base_grade,
            "effective_score": effective_score(rating.score, rating.grade, adjustment.grade),
            "risk_context": context,
            "risk_adjustments": adjustment.lines,
        }
    )
