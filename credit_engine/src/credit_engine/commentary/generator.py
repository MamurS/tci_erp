"""Findings and narrative commentary generation.

Two layers:

1. `build_findings` - structured, language-independent observations
   (strengths / weaknesses / adjustments / limit rationale). This is what
   the TCI ERP stores and what a future PDF module renders.
2. `render_commentary` - deterministic narrative paragraphs per section
   (income statement, balance sheet, ratios, conclusion) in en / ru / uz.

Unlike the legacy comment generator there is no randomness: identical input
produces identical text.
"""

from __future__ import annotations

from credit_engine.commentary.catalog import (
    DYNAMIC_PHRASES,
    FACTOR_NAMES,
    GRADE_LABELS,
    MESSAGES,
    QUALIFIERS,
)
from credit_engine.models import (
    FactorStatus,
    Finding,
    LimitResult,
    RatingResult,
    RatioReport,
    Severity,
)
from credit_engine.scoring import tables

STRENGTH_SCORE_MAX = 40.0
WEAKNESS_SCORE_MIN = 60.0
CRITICAL_SCORE_MIN = 85.0


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def fmt_money(value: float | None, currency: str) -> str:
    if value is None:
        return "-"
    sign = "-" if value < 0 else ""
    v = abs(value)
    for bound, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if v >= bound:
            return f"{sign}{v / bound:.1f}{suffix} {currency}"
    return f"{sign}{v:,.0f} {currency}"


def fmt_pct(value: float | None, decimals: int = 1) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.{decimals}f}%"


def fmt_x(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.2f}"


def dynamic_phrase(change: float | None, lang: str) -> str | None:
    """Magnitude-banded change description (legacy bands preserved)."""
    if change is None:
        return None
    phrases = DYNAMIC_PHRASES[lang]
    magnitude = abs(change)
    if magnitude < 0.001:
        return phrases["unchanged"]
    if change > 0:
        if magnitude <= 0.05:
            key = "slight_increase"
        elif magnitude <= 0.20:
            key = "increase"
        elif magnitude <= 0.50:
            key = "significant_increase"
        else:
            key = "sharp_increase"
    else:
        if magnitude <= 0.05:
            key = "slight_decrease"
        elif magnitude <= 0.20:
            key = "decrease"
        elif magnitude <= 0.50:
            key = "significant_decrease"
        else:
            key = "sharp_decrease"
    return phrases[key].format(pct=fmt_pct(magnitude, 1))


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


def build_findings(rating: RatingResult, limit: LimitResult) -> list[Finding]:
    findings: list[Finding] = []

    scored = [
        (f.score, f)
        for f in rating.factors
        if f.status == FactorStatus.SCORED and f.score is not None
    ]
    # Highest-weight factors first, then by score, so the most material
    # drivers of the rating surface first (legacy: top-10 by weight).
    for score, f in sorted(scored, key=lambda item: (-item[1].weight, item[0])):
        if score <= STRENGTH_SCORE_MAX:
            severity = Severity.STRENGTH
        elif score >= CRITICAL_SCORE_MIN:
            severity = Severity.CRITICAL
        elif score >= WEAKNESS_SCORE_MIN:
            severity = Severity.WEAKNESS
        else:
            severity = Severity.NEUTRAL
        findings.append(
            Finding(
                code=f"factor.{f.factor}",
                section="factors",
                severity=severity,
                params={
                    "factor": f.factor,
                    "value": f.value,
                    "score": f.score,
                    "weight": f.weight,
                    "band": f.band_label,
                },
            )
        )

    for f in rating.factors:
        if f.status == FactorStatus.MISSING_PENALIZED:
            findings.append(
                Finding(
                    code=f"missing_data.{f.factor}",
                    section="data_quality",
                    severity=Severity.WEAKNESS,
                    params={"factor": f.factor},
                )
            )

    for adj in rating.adjustments:
        findings.append(
            Finding(
                code=f"adjustment.{adj.code}",
                section="adjustments",
                severity=Severity.CRITICAL
                if adj.code in ("negative_equity", "negative_equity_with_loss")
                else Severity.WEAKNESS,
                params={
                    "rating_before": round(adj.rating_before, 1),
                    "rating_after": round(adj.rating_after, 1),
                    "detail": adj.detail,
                },
            )
        )

    if limit.recommended_limit == 0:
        findings.append(
            Finding(
                code="limit.zero",
                section="limit",
                severity=Severity.CRITICAL,
                params={"reasons": "; ".join(limit.reasons)},
            )
        )
    else:
        findings.append(
            Finding(
                code="limit.recommended",
                section="limit",
                severity=Severity.INFO,
                params={
                    "limit": limit.recommended_limit,
                    "currency": limit.currency,
                    "model": limit.model_used,
                },
            )
        )
    return findings


# ---------------------------------------------------------------------------
# Narrative commentary
# ---------------------------------------------------------------------------


def _income_paragraph(report: RatioReport, currency: str, lang: str) -> str:
    m = MESSAGES[lang]
    r = report.ratios
    parts: list[str] = []

    if r.get("revenue") is not None:
        sentence = m["income.revenue"].format(
            year=report.year, revenue=fmt_money(r["revenue"], currency)
        )
        dyn = dynamic_phrase(report.dynamics.get("revenue"), lang)
        if dyn:
            sentence += m["income.revenue_dyn"].format(dyn_phrase=dyn)
        parts.append(sentence + ".")

    if r.get("gross_profit") is not None:
        sentence = m["income.gross_profit"].format(
            value=fmt_money(r["gross_profit"], currency)
        )
        dyn = dynamic_phrase(report.dynamics.get("gross_profit"), lang)
        if dyn:
            sentence += m["common.and_dyn"].format(dyn_phrase=dyn)
        parts.append(sentence + ".")

    if r.get("total_operating_costs") is not None:
        parts.append(
            m["income.opex"].format(
                value=fmt_money(r["total_operating_costs"], currency),
                share=fmt_pct(r.get("operating_costs_to_revenue")),
            )
        )

    if r.get("gross_margin") is not None or r.get("operating_margin") is not None:
        parts.append(
            m["income.margins"].format(
                gross_margin=fmt_pct(r.get("gross_margin")),
                operating_margin=fmt_pct(r.get("operating_margin")),
            )
        )

    interest = r.get("interest_expenses")
    if interest is not None and interest != 0:
        parts.append(m["income.interest"].format(value=fmt_money(abs(interest), currency)))

    net_profit = r.get("net_profit")
    if net_profit is not None:
        if net_profit >= 0:
            parts.append(
                m["income.net_result_profit"].format(
                    net_profit=fmt_money(net_profit, currency),
                    net_margin=fmt_pct(r.get("net_profitability")),
                )
            )
        else:
            parts.append(
                m["income.net_result_loss"].format(
                    net_profit=fmt_money(abs(net_profit), currency)
                )
            )
    return " ".join(parts)


def _balance_paragraph(report: RatioReport, currency: str, lang: str) -> str:
    m = MESSAGES[lang]
    r = report.ratios
    parts: list[str] = []

    if r.get("total_assets") is not None:
        sentence = m["balance.assets"].format(
            total_assets=fmt_money(r["total_assets"], currency)
        )
        dyn = dynamic_phrase(report.dynamics.get("total_assets"), lang)
        if dyn:
            sentence += m["balance.assets_dyn"].format(dyn_phrase=dyn)
        parts.append(sentence + ".")

    total_assets = r.get("total_assets")
    nca = r.get("non_current_assets")
    ca = r.get("current_assets")
    if total_assets and nca is not None and ca is not None:
        parts.append(
            m["balance.structure"].format(
                nca_share=fmt_pct(nca / total_assets),
                ca_share=fmt_pct(ca / total_assets),
            )
        )

    inventories = r.get("inventories")
    receivables = r.get("accounts_receivable")
    cash = r.get("cash")
    if inventories is not None and receivables is not None and cash is not None:
        parts.append(
            m["balance.current_items"].format(
                inventories=fmt_money(inventories, currency),
                receivables=fmt_money(receivables, currency),
                cash=fmt_money(cash, currency),
            )
        )

    equity = r.get("equity")
    if equity is not None:
        if equity <= 0:
            parts.append(
                m["balance.equity_negative"].format(equity=fmt_money(equity, currency))
            )
        else:
            parts.append(
                m["balance.equity"].format(
                    equity=fmt_money(equity, currency),
                    equity_ratio=fmt_pct(r.get("equity_ratio")),
                )
            )

    if r.get("gross_debt") is not None:
        parts.append(
            m["balance.debt"].format(
                gross_debt=fmt_money(r["gross_debt"], currency),
                debt_to_assets=fmt_pct(r.get("debt_to_assets")),
            )
        )

    if r.get("accounts_payable") is not None:
        parts.append(
            m["balance.payables"].format(value=fmt_money(r["accounts_payable"], currency))
        )

    nwc = r.get("net_working_capital")
    if nwc is not None:
        key = "balance.nwc_positive" if nwc >= 0 else "balance.nwc_negative"
        parts.append(m[key].format(nwc=fmt_money(nwc, currency)))
    return " ".join(parts)


def _qualified(text: str, table: tables.ScoreTable, value: float, lang: str) -> str:
    """Append the qualitative band label, e.g. '1.61 (adequate)'."""
    _, band = table.score(value)
    label = QUALIFIERS[lang].get(band)
    return f"{text} ({label})" if label else text


def _ratios_paragraph(report: RatioReport, lang: str) -> str:
    m = MESSAGES[lang]
    r = report.ratios
    fragments: list[str] = []

    current_ratio = r.get("current_ratio")
    if current_ratio is not None:
        fragments.append(
            _qualified(
                m["ratios.current_ratio"].format(value=fmt_x(current_ratio)),
                tables.CURRENT_RATIO,
                current_ratio,
                lang,
            )
        )
    icr = r.get("interest_coverage")
    if icr is not None:
        fragments.append(
            _qualified(
                m["ratios.interest_coverage"].format(value=fmt_x(icr)),
                tables.INTEREST_COVERAGE,
                icr,
                lang,
            )
        )
    debt_to_ebit = r.get("debt_to_ebit")
    if debt_to_ebit is not None:
        fragments.append(
            _qualified(
                m["ratios.debt_to_ebit"].format(value=fmt_x(debt_to_ebit)),
                tables.DEBT_TO_EBIT,
                debt_to_ebit,
                lang,
            )
        )
    ccc = r.get("cash_conversion_cycle")
    if ccc is not None:
        fragments.append(
            _qualified(
                m["ratios.ccc"].format(value=f"{ccc:.0f}"),
                tables.CASH_CONVERSION_CYCLE,
                ccc,
                lang,
            )
        )

    parts: list[str] = []
    if fragments:
        parts.append(", ".join(fragments) + ".")
    if r.get("return_on_equity") is not None or r.get("return_on_assets") is not None:
        parts.append(
            m["ratios.returns"].format(
                roe=fmt_pct(r.get("return_on_equity")),
                roa=fmt_pct(r.get("return_on_assets")),
            )
        )
    return " ".join(parts)


def _cash_flow_paragraph(report: RatioReport, currency: str, lang: str) -> str:
    """Cash-flow commentary; empty string when no cash-flow data was provided."""
    m = MESSAGES[lang]
    r = report.ratios
    parts: list[str] = []

    cfo = r.get("operating_cash_flow")
    if cfo is not None:
        key = "cashflow.cfo_positive" if cfo >= 0 else "cashflow.cfo_negative"
        parts.append(m[key].format(value=fmt_money(cfo, currency)) + ".")

    capex = r.get("capital_expenditures")
    if capex is not None and capex != 0:
        parts.append(m["cashflow.capex"].format(value=fmt_money(abs(capex), currency)))

    fcf = r.get("free_cash_flow")
    if fcf is not None:
        key = "cashflow.fcf_positive" if fcf >= 0 else "cashflow.fcf_negative"
        parts.append(m[key].format(value=fmt_money(fcf, currency)))
    return " ".join(parts)


def _top_factor_names(
    rating: RatingResult, lang: str, *, strengths: bool, top_n: int = 3
) -> list[str]:
    names = FACTOR_NAMES[lang]
    scored = [
        (f.score, f)
        for f in rating.factors
        if f.status == FactorStatus.SCORED and f.score is not None
    ]
    if strengths:
        pool = [(score, f) for score, f in scored if score <= STRENGTH_SCORE_MAX]
        pool.sort(key=lambda item: (item[0], -item[1].weight))
    else:
        pool = [(score, f) for score, f in scored if score >= WEAKNESS_SCORE_MIN]
        pool.sort(key=lambda item: (-item[0], -item[1].weight))
    return [names[f.factor] for _, f in pool[:top_n]]


def _conclusion_paragraph(
    rating: RatingResult, limit: LimitResult, currency: str, lang: str
) -> str:
    m = MESSAGES[lang]
    parts: list[str] = []

    if rating.score is not None and rating.grade is not None:
        parts.append(
            m["conclusion.rating"].format(
                score=f"{rating.score:.0f}",
                grade=rating.grade,
                grade_label=GRADE_LABELS[lang][rating.grade_label_key or ""],
            )
        )

    strengths = _top_factor_names(rating, lang, strengths=True)
    if strengths:
        parts.append(m["conclusion.strengths"].format(items=", ".join(strengths)))
    weaknesses = _top_factor_names(rating, lang, strengths=False)
    if weaknesses:
        parts.append(m["conclusion.weaknesses"].format(items=", ".join(weaknesses)))

    for adj in rating.adjustments:
        parts.append(
            m["conclusion.adjustment"].format(
                code=m.get(f"adj.{adj.code}", adj.code), detail=adj.detail
            )
        )

    if limit.recommended_limit > 0:
        parts.append(
            m["conclusion.limit"].format(
                limit=fmt_money(limit.recommended_limit, currency)
            )
        )
    else:
        parts.append(m["conclusion.limit_zero"].format(reasons="; ".join(limit.reasons)))

    if rating.data_coverage < 1.0:
        parts.append(m["conclusion.coverage"].format(coverage=fmt_pct(rating.data_coverage, 0)))
    return " ".join(parts)


def render_commentary(
    rating: RatingResult,
    limit: LimitResult,
    latest_report: RatioReport,
    currency: str,
    lang: str,
) -> dict[str, str]:
    if lang not in MESSAGES:
        raise ValueError(f"unsupported language: {lang!r}")
    commentary = {
        "income_statement": _income_paragraph(latest_report, currency, lang),
        "balance_sheet": _balance_paragraph(latest_report, currency, lang),
        "financial_ratios": _ratios_paragraph(latest_report, lang),
        "conclusion": _conclusion_paragraph(rating, limit, currency, lang),
    }
    cash_flow = _cash_flow_paragraph(latest_report, currency, lang)
    if cash_flow:
        commentary["cash_flow"] = cash_flow
    return commentary
