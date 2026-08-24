"""Message catalogs for generated commentary (en / ru / uz).

Commentary is produced from structured findings via these templates, so the
narrative is deterministic and translatable. Adding a language = adding one
dictionary; no logic changes (the legacy module had five ~220-line copies of
the same dict inside a 1,462-line match statement).
"""

from __future__ import annotations

SUPPORTED_LANGUAGES = ("en", "ru", "uz")

GRADE_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "grade.excellent": "Excellent",
        "grade.very_good": "Very good",
        "grade.good": "Good",
        "grade.acceptable": "Acceptable",
        "grade.weak": "Weak",
        "grade.very_weak": "Very weak",
        "grade.unacceptable": "Unacceptable",
    },
    "ru": {
        "grade.excellent": "Отличный",
        "grade.very_good": "Очень хороший",
        "grade.good": "Хороший",
        "grade.acceptable": "Приемлемый",
        "grade.weak": "Слабый",
        "grade.very_weak": "Очень слабый",
        "grade.unacceptable": "Неприемлемый",
    },
    "uz": {
        "grade.excellent": "A'lo",
        "grade.very_good": "Juda yaxshi",
        "grade.good": "Yaxshi",
        "grade.acceptable": "Qoniqarli",
        "grade.weak": "Zaif",
        "grade.very_weak": "Juda zaif",
        "grade.unacceptable": "Nomaqbul",
    },
}

FACTOR_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "net_profitability": "net profitability",
        "equity_ratio": "equity ratio",
        "debt_to_assets": "debt to assets",
        "total_assets_dynamic": "total assets trend",
        "current_ratio": "current liquidity",
        "interest_coverage": "interest coverage",
        "interest_coverage_dynamic": "interest coverage trend",
        "debt_to_equity": "financial leverage",
        "cash_conversion_cycle": "cash conversion cycle",
        "revenue_usd": "business scale (revenue)",
        "age_years": "company age",
        "debt_to_ebit": "debt to EBIT",
        "revenue_dynamic": "revenue trend",
    },
    "ru": {
        "net_profitability": "чистая рентабельность",
        "equity_ratio": "доля собственного капитала",
        "debt_to_assets": "долг к активам",
        "total_assets_dynamic": "динамика активов",
        "current_ratio": "текущая ликвидность",
        "interest_coverage": "покрытие процентов",
        "interest_coverage_dynamic": "динамика покрытия процентов",
        "debt_to_equity": "финансовый левередж",
        "cash_conversion_cycle": "цикл оборота денежных средств",
        "revenue_usd": "масштаб бизнеса (выручка)",
        "age_years": "возраст компании",
        "debt_to_ebit": "долг к EBIT",
        "revenue_dynamic": "динамика выручки",
    },
    "uz": {
        "net_profitability": "sof rentabellik",
        "equity_ratio": "o'z kapitali ulushi",
        "debt_to_assets": "qarzning aktivlarga nisbati",
        "total_assets_dynamic": "aktivlar dinamikasi",
        "current_ratio": "joriy likvidlik",
        "interest_coverage": "foizlarni qoplash",
        "interest_coverage_dynamic": "foizlarni qoplash dinamikasi",
        "debt_to_equity": "moliyaviy leveraj",
        "cash_conversion_cycle": "pul aylanish sikli",
        "revenue_usd": "biznes ko'lami (tushum)",
        "age_years": "kompaniya yoshi",
        "debt_to_ebit": "qarzning EBITga nisbati",
        "revenue_dynamic": "tushum dinamikasi",
    },
}

#: Phrases describing a year-over-year change, keyed by magnitude band.
DYNAMIC_PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "unchanged": "remained practically unchanged",
        "slight_increase": "increased slightly by {pct}",
        "increase": "increased by {pct}",
        "significant_increase": "increased significantly by {pct}",
        "sharp_increase": "grew sharply by {pct}",
        "slight_decrease": "decreased slightly by {pct}",
        "decrease": "decreased by {pct}",
        "significant_decrease": "decreased significantly by {pct}",
        "sharp_decrease": "fell sharply by {pct}",
    },
    "ru": {
        "unchanged": "практически не изменилась",
        "slight_increase": "незначительно выросла на {pct}",
        "increase": "выросла на {pct}",
        "significant_increase": "существенно выросла на {pct}",
        "sharp_increase": "резко выросла на {pct}",
        "slight_decrease": "незначительно снизилась на {pct}",
        "decrease": "снизилась на {pct}",
        "significant_decrease": "существенно снизилась на {pct}",
        "sharp_decrease": "резко упала на {pct}",
    },
    "uz": {
        "unchanged": "deyarli o'zgarmadi",
        "slight_increase": "{pct} ga biroz o'sdi",
        "increase": "{pct} ga o'sdi",
        "significant_increase": "{pct} ga sezilarli o'sdi",
        "sharp_increase": "{pct} ga keskin o'sdi",
        "slight_decrease": "{pct} ga biroz kamaydi",
        "decrease": "{pct} ga kamaydi",
        "significant_decrease": "{pct} ga sezilarli kamaydi",
        "sharp_decrease": "{pct} ga keskin tushdi",
    },
}

MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        "income.revenue": "Revenue for {year} amounted to {revenue}",
        "income.revenue_dyn": " and {dyn_phrase} year-over-year",
        "income.margins": (
            "Gross margin was {gross_margin}, operating margin {operating_margin}."
        ),
        "income.net_result_profit": (
            "The company closed the period with a net profit of {net_profit} "
            "({net_margin} of revenue)."
        ),
        "income.net_result_loss": (
            "The company closed the period with a net loss of {net_profit}."
        ),
        "balance.assets": "Total assets stood at {total_assets}",
        "balance.assets_dyn": " and {dyn_phrase} over the year",
        "balance.equity": (
            "Equity amounted to {equity}, financing {equity_ratio} of the balance sheet."
        ),
        "balance.equity_negative": (
            "Equity is negative ({equity}): liabilities exceed assets."
        ),
        "balance.debt": (
            "Total interest-bearing debt was {gross_debt} ({debt_to_assets} of assets)."
        ),
        "balance.nwc_positive": "Net working capital is positive at {nwc}.",
        "balance.nwc_negative": (
            "Net working capital is negative at {nwc}: current liabilities exceed "
            "current assets."
        ),
        "ratios.current_ratio": "Current ratio is {value}",
        "ratios.interest_coverage": "interest coverage is {value}x",
        "ratios.debt_to_ebit": "debt to EBIT is {value}x",
        "ratios.ccc": "the cash conversion cycle is {value} days",
        "ratios.returns": "Return on equity is {roe}, return on assets {roa}.",
        "conclusion.rating": (
            "The credit rating is {score} on a 1-100 scale (lower is better), "
            "grade {grade} - {grade_label}."
        ),
        "conclusion.strengths": "Key strengths: {items}.",
        "conclusion.weaknesses": "Key weaknesses: {items}.",
        "conclusion.limit": "Recommended credit limit: {limit}.",
        "conclusion.limit_zero": "No credit limit is recommended: {reasons}.",
        "conclusion.adjustment": "Rating adjustment applied ({code}): {detail}.",
        "conclusion.coverage": "Assessment is based on {coverage} of the model's factor weight.",
        "adj.negative_equity": "negative equity",
        "adj.negative_equity_with_loss": "negative equity combined with a net loss",
        "adj.new_company": "short operating history",
        "adj.litigation_pressure": "significant litigation exposure",
        "adj.insufficient_data": "insufficient financial data",
        "adj.weak_equity_dominance": "weak capitalization dominates the assessment",
    },
    "ru": {
        "income.revenue": "Выручка за {year} год составила {revenue}",
        "income.revenue_dyn": " и {dyn_phrase} к прошлому году",
        "income.margins": (
            "Валовая рентабельность составила {gross_margin}, операционная - {operating_margin}."
        ),
        "income.net_result_profit": (
            "Период завершён с чистой прибылью {net_profit} ({net_margin} от выручки)."
        ),
        "income.net_result_loss": "Период завершён с чистым убытком {net_profit}.",
        "balance.assets": "Совокупные активы составили {total_assets}",
        "balance.assets_dyn": " и за год {dyn_phrase}",
        "balance.equity": (
            "Собственный капитал составил {equity}, финансируя {equity_ratio} баланса."
        ),
        "balance.equity_negative": (
            "Собственный капитал отрицательный ({equity}): обязательства превышают активы."
        ),
        "balance.debt": "Совокупный долг составил {gross_debt} ({debt_to_assets} активов).",
        "balance.nwc_positive": "Чистый оборотный капитал положительный: {nwc}.",
        "balance.nwc_negative": (
            "Чистый оборотный капитал отрицательный ({nwc}): краткосрочные обязательства "
            "превышают оборотные активы."
        ),
        "ratios.current_ratio": "Коэффициент текущей ликвидности - {value}",
        "ratios.interest_coverage": "покрытие процентов - {value}x",
        "ratios.debt_to_ebit": "долг к EBIT - {value}x",
        "ratios.ccc": "цикл оборота денежных средств - {value} дн.",
        "ratios.returns": "Рентабельность капитала (ROE) - {roe}, активов (ROA) - {roa}.",
        "conclusion.rating": (
            "Кредитный рейтинг - {score} по шкале 1-100 (меньше - лучше), "
            "класс {grade} - {grade_label}."
        ),
        "conclusion.strengths": "Ключевые сильные стороны: {items}.",
        "conclusion.weaknesses": "Ключевые слабые стороны: {items}.",
        "conclusion.limit": "Рекомендуемый кредитный лимит: {limit}.",
        "conclusion.limit_zero": "Кредитный лимит не рекомендуется: {reasons}.",
        "conclusion.adjustment": "Применена корректировка рейтинга ({code}): {detail}.",
        "conclusion.coverage": "Оценка основана на {coverage} весов факторов модели.",
        "adj.negative_equity": "отрицательный собственный капитал",
        "adj.negative_equity_with_loss": "отрицательный капитал в сочетании с убытком",
        "adj.new_company": "короткая операционная история",
        "adj.litigation_pressure": "существенная судебная нагрузка",
        "adj.insufficient_data": "недостаточность финансовых данных",
        "adj.weak_equity_dominance": "слабая капитализация доминирует в оценке",
    },
    "uz": {
        "income.revenue": "{year} yil uchun tushum {revenue} ni tashkil etdi",
        "income.revenue_dyn": " va o'tgan yilga nisbatan {dyn_phrase}",
        "income.margins": (
            "Yalpi rentabellik {gross_margin}, operatsion rentabellik {operating_margin} bo'ldi."
        ),
        "income.net_result_profit": (
            "Davr {net_profit} sof foyda bilan yakunlandi (tushumning {net_margin}i)."
        ),
        "income.net_result_loss": "Davr {net_profit} sof zarar bilan yakunlandi.",
        "balance.assets": "Jami aktivlar {total_assets} ni tashkil etdi",
        "balance.assets_dyn": " va yil davomida {dyn_phrase}",
        "balance.equity": (
            "O'z kapitali {equity} ni tashkil etib, balansning {equity_ratio}ini moliyalashtiradi."
        ),
        "balance.equity_negative": (
            "O'z kapitali manfiy ({equity}): majburiyatlar aktivlardan ortiq."
        ),
        "balance.debt": "Jami qarz {gross_debt} ni tashkil etdi (aktivlarning {debt_to_assets}i).",
        "balance.nwc_positive": "Sof aylanma kapital ijobiy: {nwc}.",
        "balance.nwc_negative": (
            "Sof aylanma kapital manfiy ({nwc}): qisqa muddatli majburiyatlar "
            "joriy aktivlardan ortiq."
        ),
        "ratios.current_ratio": "Joriy likvidlik koeffitsienti - {value}",
        "ratios.interest_coverage": "foizlarni qoplash - {value}x",
        "ratios.debt_to_ebit": "qarzning EBITga nisbati - {value}x",
        "ratios.ccc": "pul aylanish sikli - {value} kun",
        "ratios.returns": (
            "Kapital rentabelligi (ROE) - {roe}, aktivlar rentabelligi (ROA) - {roa}."
        ),
        "conclusion.rating": (
            "Kredit reytingi - 1-100 shkala bo'yicha {score} (kam - yaxshi), "
            "daraja {grade} - {grade_label}."
        ),
        "conclusion.strengths": "Asosiy kuchli tomonlar: {items}.",
        "conclusion.weaknesses": "Asosiy zaif tomonlar: {items}.",
        "conclusion.limit": "Tavsiya etilgan kredit limiti: {limit}.",
        "conclusion.limit_zero": "Kredit limiti tavsiya etilmaydi: {reasons}.",
        "conclusion.adjustment": "Reyting tuzatishi qo'llanildi ({code}): {detail}.",
        "conclusion.coverage": "Baholash model omillari vaznining {coverage}iga asoslangan.",
        "adj.negative_equity": "manfiy o'z kapitali",
        "adj.negative_equity_with_loss": "manfiy kapital va zarar birgalikda",
        "adj.new_company": "qisqa faoliyat tarixi",
        "adj.litigation_pressure": "sezilarli sud yuklamasi",
        "adj.insufficient_data": "moliyaviy ma'lumotlar yetarli emas",
        "adj.weak_equity_dominance": "zaif kapitallashuv baholashda ustunlik qiladi",
    },
}
