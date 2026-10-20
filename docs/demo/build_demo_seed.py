"""Build docs/demo/demo-seed.sql — the MVP demonstration dataset.

    cd services/analytics && uv run python ../../docs/demo/build_demo_seed.py

The ratings are REAL engine output: every demo statement is rated by the
analytics service's own /rating and /credit-limit handlers (imported, not
called over HTTP), exactly as the Rating tab does, and the response is stored
the way RatingTab.tsx stores it. Everything else is written by the SQL script
itself — through the workflow functions, as impersonated demo users, wherever
the application would go through one (see the script's header).

Deterministic: ids are md5('demo:' || name), so rebuilding gives the same file
and the SQL can find any of them without a lookup table.
The demo password is NOT here; only its bcrypt hash, passed in DEMO_HASH.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "services" / "analytics"))

from app.main import credit_limit, rating  # noqa: E402
from app.schemas import CreditLimitRequest, StatementPayload  # noqa: E402

def uid(name: str) -> str:
    """md5('demo:' || name)::uuid — the rule pg_temp.k() applies in SQL."""
    return str(uuid.UUID(hashlib.md5(f"demo:{name}".encode()).hexdigest()))


def q(value: object) -> str:
    """SQL literal."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(round(value, 2)) if isinstance(value, float) else str(value)
    return "'" + str(value).replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
USERS = [
    # key, email, full name, roles
    ("sales", "demo.sales@demo.invalid", "Dilnoza Karimova", ["sales"]),
    ("commercial", "demo.commercial@demo.invalid", "Rustam Aliyev", ["commercial_underwriter"]),
    ("credit", "demo.credit@demo.invalid", "Nodira Yusupova", ["credit_underwriter"]),
    ("credit_jr", "demo.credit.junior@demo.invalid", "Bekzod Tursunov", ["credit_underwriter"]),
    ("claims", "demo.claims@demo.invalid", "Sardor Rakhimov", ["claims"]),
    ("info", "demo.info@demo.invalid", "Malika Nazarova", ["information_manager"]),
    ("client", "demo.client@demo.invalid", "Aziz Saidov", ["client"]),
]

# authority: (stream, band, amount, currency)
GRANTS = {
    "credit": [("credit", "A", 2_000_000, "USD"), ("credit", "B", 1_000_000, "USD"),
               ("credit", "C", 300_000, "USD"), ("credit", "D", 50_000, "USD"),
               ("credit", "unrated", 25_000, "USD")],
    "credit_jr": [("credit", "A", 250_000, "USD"), ("credit", "B", 120_000, "USD"),
                  ("credit", "C", 40_000, "USD")],
    "commercial": [("commercial", "A", 1_000_000, "USD"), ("commercial", "B", 500_000, "USD"),
                   ("commercial", "C", 250_000, "USD"), ("commercial", "D", 25_000, "USD")],
}

# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------
# key: (name, legal form, country, industry, reg no, founded, city/address, contact, email domain)
COMPANIES = {
    # policyholders (Uzbekistan)
    "P1": ("Samarkand Textile MChJ", "MChJ", "UZ", "TEXT", "305112847", "2009-04-14", "Samarqand sh., Registon ko‘chasi 12", "Aziz Saidov", "samtex.uz"),
    "P2": ("Fergana Cotton Export AJ", "AJ", "UZ", "AGRI", "302447019", "2004-09-02", "Farg‘ona sh., Mustaqillik ko‘chasi 45", "Shahzoda Ergasheva", "fce.uz"),
    "P3": ("Navoi Copper Trade MChJ", "MChJ", "UZ", "METL", "306991204", "2012-06-20", "Navoiy sh., Galaba shoh ko‘chasi 8", "Jamshid Qodirov", "navoicopper.uz"),
    "P4": ("Tashkent Pharma Distribution MChJ", "MChJ", "UZ", "PHAR", "307551863", "2015-02-11", "Toshkent sh., Amir Temur shoh ko‘chasi 108", "Gulnora Ismoilova", "tpd.uz"),
    "P5": ("Andijan Auto Components MChJ", "MChJ", "UZ", "AUTO", "308114520", "2017-11-03", "Andijon sh., Bobur shoh ko‘chasi 77", "Oybek Mirzayev", "aac.uz"),
    "P6": ("Bukhara Food Export MChJ", "MChJ", "UZ", "FOOD", "309447781", "2019-03-29", "Buxoro sh., Navoiy ko‘chasi 15", "Laylo Hamidova", "bfe.uz"),
    # prospects (submissions in the pipeline)
    "S1": ("Khorezm Agro Export MChJ", "MChJ", "UZ", "AGRI", "310224569", "2016-05-18", "Urganch sh., Al-Xorazmiy ko‘chasi 3", "Farrux Yo‘ldoshev", "khorezmagro.uz"),
    "S2": ("Kokand Glass Works AJ", "AJ", "UZ", "CNST", "310887123", "2011-08-09", "Qo‘qon sh., Turkiston ko‘chasi 21", "Nilufar Abdullayeva", "kokandglass.uz"),
    "S3": ("Namangan Fruit Logistics MChJ", "MChJ", "UZ", "TRAN", "311004556", "2018-01-25", "Namangan sh., Uychi ko‘chasi 9", "Sherzod Xolmatov", "nfl.uz"),
    "S4": ("Jizzakh Cement MChJ", "MChJ", "UZ", "CNST", "311559902", "2020-07-07", "Jizzax sh., Sharof Rashidov ko‘chasi 50", "Akmal Usmonov", "jizzakhcement.uz"),
    # buyers
    "B1": ("OOO Ozon Volga", "OOO", "RU", "WHTR", "1166313091234", "2010-03-15", "Samara, ul. Molodogvardeyskaya 204", "Elena Sokolova", "ozon-volga.ru"),
    "B2": ("OOO Ozon Sibir", "OOO", "RU", "WHTR", "1155476054321", "2013-10-01", "Novosibirsk, Krasny prospekt 77", "Igor Belov", "ozon-sibir.ru"),
    "B3": ("Berliner Textilhandel GmbH", "GmbH", "DE", "TEXT", "HRB 154872", "1998-05-12", "Berlin, Friedrichstraße 112", "Markus Weber", "btextil.de"),
    "B4": ("TOO Almaty Trade Center", "TOO", "KZ", "WHTR", "080440011234", "2008-04-22", "Almaty, Abay ave. 150", "Aigerim Nurlanova", "atc.kz"),
    "B5": ("Istanbul Tekstil A.Ş.", "A.Ş.", "TR", "TEXT", "548712", "2001-02-14", "İstanbul, Merter Tekstil Merkezi 18", "Mehmet Yılmaz", "istanbultekstil.com.tr"),
    "B6": ("Shanghai Huamei Trading Co., Ltd.", "Co., Ltd.", "CN", "WHTR", "91310000MA1FL4XQ2B", "2006-09-30", "Shanghai, Pudong, Zhangjiang Rd 88", "Li Wei", "huamei.cn"),
    "B7": ("Gulf Commodities FZE", "FZE", "AE", "METL", "FZE-118845", "2014-12-01", "Dubai, Jebel Ali Free Zone, LOB 15", "Omar Haddad", "gulfcommodities.ae"),
    "B8": ("Warszawa Import Sp. z o.o.", "Sp. z o.o.", "PL", "WHTR", "KRS 0000415528", "2011-06-17", "Warszawa, ul. Marszałkowska 99", "Anna Kowalska", "wawimport.pl"),
    "B9": ("Milano Moda S.r.l.", "S.r.l.", "IT", "TEXT", "MI-2045871", "2003-03-03", "Milano, Via della Spiga 22", "Giulia Rossi", "milanomoda.it"),
    "B10": ("AO Moscow Pharma Distribution", "AO", "RU", "PHAR", "1027700132195", "1999-11-11", "Moskva, Leninsky prospekt 45", "Olga Petrova", "mpd.ru"),
    "B11": ("AO Kazakh Copper Processing", "AO", "KZ", "METL", "991140000876", "1999-11-30", "Karaganda, Bukhar-Zhyrau ave. 32", "Daniyar Seitkali", "kazcopper.kz"),
    "B12": ("Seoul Auto Parts Co., Ltd.", "Co., Ltd.", "KR", "AUTO", "110111-4567891", "2005-08-08", "Seoul, Gangnam-gu, Teheran-ro 427", "Kim Min-jun", "seoulautoparts.kr"),
    "B13": ("Tashkent Supermarket Chain MChJ", "MChJ", "UZ", "RETL", "306118834", "2013-09-13", "Toshkent sh., Shota Rustaveli ko‘chasi 41", "Bobur Rahimov", "tsc.uz"),
    "B14": ("Samarkand Retail MChJ", "MChJ", "UZ", "RETL", "312240987", "2021-04-01", "Samarqand sh., Dagbitskaya ko‘chasi 30", "Kamola Juraeva", "samretail.uz"),
    "B15": ("Hamburger Metallhandel GmbH", "GmbH", "DE", "METL", "HRB 98234", "1987-01-20", "Hamburg, Am Sandtorkai 41", "Jonas Fischer", "hhmetall.de"),
    "B16": ("Ankara Tekstil Sanayi A.Ş.", "A.Ş.", "TR", "TEXT", "312877", "2009-10-10", "Ankara, OSTİM OSB 1203", "Ayşe Demir", "ankaratekstil.com.tr"),
    "B17": ("Dubai Fresh Foods LLC", "LLC", "AE", "FOOD", "DED-778412", "2016-02-02", "Dubai, Al Aweer Central Market 7", "Fatima Al Mansoori", "dubaifresh.ae"),
    # group parents
    "G1": ("PAO Ozon Holding", "PAO", "RU", "WHTR", "1027739019208", "1998-02-27", "Moskva, Presnenskaya nab. 10", "Sergey Ivanov", "ozon-holding.ru"),
    "G2": ("Koç Ticaret Holding A.Ş.", "A.Ş.", "TR", "WHTR", "201145", "1990-07-01", "İstanbul, Nakkaştepe, Azizbey Sk. 1", "Can Öztürk", "kocticaret.com.tr"),
}

# Statements: profile per year 2023, 2024, 2025; None = no statement that year.
# (currency, revenue 2023 in thousands, profiles)
FIN = {
    "B1": ("RUB", 9_800_000, ["strong", "strong", "weak"]),          # worse since the decision
    "B2": ("RUB", 4_100_000, ["good", "good", "good"]),
    "B3": ("EUR", 58_000, ["good", "good", "average"]),
    "B4": ("KZT", 21_500_000, ["average", "good", "strong"]),        # 2025 not yet rated
    "B5": ("TRY", 1_350_000, ["average", "weak", "weak"]),
    "B6": ("CNY", 5_800_000, ["excellent", "excellent", "excellent"]),
    "B7": ("USD", 95_000, ["good", "average", "average"]),
    "B8": ("EUR", 22_000, ["average", "average", "good"]),
    "B9": ("EUR", 31_000, ["good", "average", "average"]),
    "B10": ("RUB", 6_300_000, ["good", "good", None]),               # rated 14 months ago, 2025 not filed
    "B11": ("KZT", 48_000_000, ["strong", "good", "good"]),
    "B12": ("KRW", 160_000_000, ["weak", "distressed", "collapse"]),
    "B13": ("UZS", 410_000_000, ["good", "strong", "strong"]),
    "B15": ("EUR", 140_000, [None, "good", "good"]),                 # statements, never rated
    "B16": ("TRY", 820_000, ["good", "good", "average"]),
    "B17": ("AED", 120_000, ["average", "good", "good"]),
    "G1": ("RUB", 38_000_000, ["strong", "strong", "good"]),
}

# Which statement year each buyer is rated on, and how long ago (days).
# Several ratings per buyer build the score history.
RATINGS = {
    "B1": [(2023, 420), (2024, 300)],        # decided on the strong 2024 rating ...
    "B2": [(2024, 260), (2025, 40)],
    "B3": [(2024, 280), (2025, 35)],
    "B4": [(2024, 200)],                     # 2025 statement since: new_statement
    "B5": [(2024, 250), (2025, 30)],
    "B6": [(2024, 240), (2025, 25)],
    "B7": [(2025, 60)],
    "B8": [(2025, 45)],
    "B9": [(2025, 50)],
    "B10": [(2024, 430)],                    # older than a year: stale
    "B11": [(2024, 210), (2025, 20)],
    "B12": [(2024, 300), (2025, 15)],
    "B13": [(2024, 190), (2025, 28)],
    "B16": [(2025, 55)],
    "B17": [(2025, 33)],
    "G1": [(2025, 70)],
}
RATINGS_LATER = {"B1": [(2025, 18)]}         # ... and rated weak since

USD_PER = {"USD": 1, "EUR": 0.92, "RUB": 92.0, "KZT": 510.0, "TRY": 41.0, "CNY": 7.2,
           "AED": 3.67, "KRW": 1380.0, "UZS": 12025.33}

PROFILES = {
    #            gm    opex  eq    cr    growth rec  inv  pay  cash  rate
    "excellent": (0.56, 0.12, 0.90, 3.4, 1.22, 15, 12, 90, 0.35, 0.04),
    "strong":    (0.32, 0.13, 0.56, 2.1, 1.12, 45, 50, 40, 0.12, 0.07),
    "good":      (0.26, 0.14, 0.42, 1.6, 1.07, 55, 60, 45, 0.08, 0.09),
    "average":   (0.20, 0.145, 0.30, 1.25, 1.02, 70, 75, 55, 0.05, 0.12),
    "weak":      (0.15, 0.135, 0.17, 1.02, 0.95, 95, 95, 75, 0.03, 0.16),
    "distressed":(0.10, 0.13, 0.05, 0.78, 0.82, 130, 120, 110, 0.015, 0.22),
    "collapse":  (0.06, 0.14, 0.03, 0.62, 0.70, 150, 140, 140, 0.01, 0.30),
}


def statement(revenue: float, profile: str) -> tuple[dict, dict]:
    gm, opex, eq, cr, _g, rec_d, inv_d, pay_d, cash_p, rate = PROFILES[profile]
    r = round(revenue)
    cogs = round(r * (1 - gm))
    gp = r - cogs
    dist = round(r * opex * 0.55)
    admin = round(r * opex * 0.45)
    op = gp - dist - admin
    ta = round(r * 0.62)
    equity = round(ta * eq)
    liabilities = ta - equity
    receivables = round(r * rec_d / 365)
    inventories = round(cogs * inv_d / 365)
    cash = round(ta * cash_p)
    oca = round(ta * 0.02)
    ca = receivables + inventories + cash + oca
    if ca > ta * 0.85:
        scale = ta * 0.85 / ca
        receivables, inventories, cash, oca = (round(x * scale) for x in (receivables, inventories, cash, oca))
        ca = receivables + inventories + cash + oca
    nca = ta - ca
    ppe = round(nca * 0.88)
    intangibles = nca - ppe
    cl = round(ca / cr)
    if cl > liabilities:
        cl = liabilities
    ncl = liabilities - cl
    payables = min(round(cogs * pay_d / 365), round(cl * 0.7))
    other_pay = round(cl * 0.08)
    stb = cl - payables - other_pay
    ltb = round(ncl * 0.9)
    dtl = ncl - ltb
    debt = stb + ltb
    fin = round(debt * rate)
    pbt = op - fin
    tax = round(max(pbt, 0) * 0.15)
    net = pbt - tax
    share = round(equity * 0.2)
    retained = equity - share
    bs = {
        "property_plant_equipment": ppe, "intangible_assets": intangibles,
        "total_non_current_assets": nca,
        "inventories": inventories, "trade_receivables": receivables,
        "cash_and_equivalents": cash, "other_current_assets": oca,
        "total_current_assets": ca, "total_assets": ta,
        "share_capital": share, "retained_earnings": retained, "total_equity": equity,
        "long_term_borrowings": ltb, "deferred_tax_liabilities": dtl,
        "total_non_current_liabilities": ncl,
        "short_term_borrowings": stb, "trade_payables": payables, "other_payables": other_pay,
        "total_current_liabilities": cl, "total_liabilities": liabilities,
        "total_equity_and_liabilities": ta,
    }
    inc = {
        "revenue": r, "cost_of_sales": cogs, "gross_profit": gp,
        "distribution_expenses": dist, "administrative_expenses": admin,
        "operating_profit": op, "finance_costs": fin, "profit_before_tax": pbt,
        "income_tax": tax, "net_profit": net, "depreciation_amortization": round(ppe * 0.08),
    }
    return bs, inc


def build_statements() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for key, (ccy, rev0, profiles) in FIN.items():
        rows = []
        rev = rev0
        for i, profile in enumerate(profiles):
            year = 2023 + i
            if profile is None:
                continue
            if i:
                rev = rev * PROFILES[profile][4]
            bs, inc = statement(rev, profile)
            rows.append({"id": uid(f"stmt:{key}:{year}"), "year": year, "currency": ccy, "bs": bs, "inc": inc})
        out[key] = rows
    return out


def rate_buyer(key: str, stmts: list[dict], year: int) -> dict:
    name, _lf, country, _ind, _reg, founded, *_ = COMPANIES[key]
    window = [s for s in stmts if s["year"] <= year][-3:]
    ccy = window[-1]["currency"]
    age = year + 1 - int(founded[:4])
    payload = {
        "buyer": {"name": name, "country_code": country, "age_years": age},
        "currency": ccy,
        "unit": "thousands",
        "exchange_rate_usd": USD_PER[ccy],
        "report_type": "statutory",
        "periods": [
            {"fiscal_year": s["year"], "statement_kind": "annual",
             "balance_sheet": s["bs"], "income_statement": s["inc"]}
            for s in window
        ],
    }
    r = rating(StatementPayload(**payload))
    lim = credit_limit(CreditLimitRequest(**payload, rating_score=r.score))
    return {
        "statement_id": window[-1]["id"],
        "score": r.score, "grade": r.grade, "limit": lim.suggested_limit, "limit_ccy": lim.currency,
        "payload": payload,
        "trace": {"rating": json.loads(r.model_dump_json()), "limit": json.loads(lim.model_dump_json())},
        "engine": r.engine_version,
    }


def main() -> None:
    demo_hash = os.environ["DEMO_HASH"]
    stmts = build_statements()
    assessments = []  # (key, days_ago, result)
    for key, plan in list(RATINGS.items()) + list(RATINGS_LATER.items()):
        for year, days in plan:
            assessments.append((key, days, rate_buyer(key, stmts[key], year)))

    parts: list[str] = []
    w = parts.append

    # users
    w("-- ---------------------------------------------------------------------------")
    w("-- 2. Demo users — one per department role, plus a junior credit underwriter")
    w("--    with a small authority so escalation can be shown. Password: given out")
    w("--    of band; only its bcrypt hash is here. No forced rotation (demo).")
    w("-- ---------------------------------------------------------------------------")
    for key, email, full_name, roles in USERS:
        u = uid(f"user:{key}")
        w(f"""insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token, is_super_admin, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', {q(u)}, 'authenticated', 'authenticated', {q(email)}, {q(demo_hash)},
  now(), now() - interval '120 days', now(), '{{"provider":"email","providers":["email"]}}'::jsonb,
  jsonb_build_object('full_name', {q(full_name)}), '', '', '', '', '', '', '', '', null, false, false);
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values ({q(u)}, {q(u)}, jsonb_build_object('sub', {q(u)}, 'email', {q(email)}, 'email_verified', true), 'email', now(), now());
insert into tci.user_profiles (user_id, full_name, must_change_password) values ({q(u)}, {q(full_name)}, false);""")
        for role in roles:
            w(f"insert into tci.user_roles (user_id, role) values ({q(u)}, {q(role)});")
        for stream, band, amount, ccy in GRANTS.get(key, []):
            w(f"insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) "
              f"values ({q(u)}, {q(stream)}, {q(band)}, {amount}, {q(ccy)}, current_date - 120, {q(u)});")

    # companies
    w("")
    w("-- ---------------------------------------------------------------------------")
    w("-- 4. Companies, statements (IFRS form, thousands) and ratings")
    w("-- ---------------------------------------------------------------------------")
    info = uid("user:info")
    for key, (name, lf, country, ind, reg, founded, addr, contact, domain) in COMPANIES.items():
        email = f"{contact.split()[0].lower()}@{domain}"
        w(f"insert into tci.legal_entities (id, name, legal_form, country_code, industry_id, registration_number, founded_date, "
          f"website, address, contact_person, contact_email, created_by, created_at) values ({q(uid('ent:' + key))}, {q(name)}, {q(lf)}, "
          f"{q(country)}, {q(ind)}, {q(reg)}, {q(founded)}, {q('https://' + domain)}, {q(addr)}, {q(contact)}, {q(email)}, {q(info)}, now() - interval '200 days');")
    for key, rows in stmts.items():
        for s in rows:
            w(f"insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, unit, "
              f"audited, source, accounting_basis, mapping_status, report_type, created_by, created_at) values ({q(s['id'])}, "
              f"{q(uid('ent:' + key))}, 'annual', {s['year']}, '{s['year']}-12-31', {q(s['currency'])}, 'thousands', {q(s['year'] < 2025)}, "
              f"'Annual report', 'ifrs', 'n/a', 'statutory', {q(info)}, timestamp '{s['year'] + 1}-04-15 10:00+05');")
            cols = ", ".join(s["bs"])
            vals = ", ".join(str(v) for v in s["bs"].values())
            w(f"insert into tci.balance_sheets (statement_id, {cols}) values ({q(s['id'])}, {vals});")
            cols = ", ".join(s["inc"])
            vals = ", ".join(str(v) for v in s["inc"].values())
            w(f"insert into tci.income_statements (statement_id, {cols}) values ({q(s['id'])}, {vals});")
    credit = uid("user:credit")
    for key, days, a in assessments:
        aid = uid(f"assess:{key}:{days}")
        w(f"insert into tci.credit_assessments (id, entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency, "
          f"inputs_snapshot, calculation_trace, engine_version, created_by, created_at) values ({q(aid)}, {q(uid('ent:' + key))}, "
          f"{q(a['statement_id'])}, {a['score']}, {q(a['grade'])}, {a['limit']}, {q(a['limit_ccy'])}, "
          f"{q(json.dumps(a["payload"], ensure_ascii=False, separators=(",", ":")))}::jsonb, {q(json.dumps(a["trace"], ensure_ascii=False, separators=(",", ":")))}::jsonb, "
          f"{q(a['engine'])}, {q(credit)}, now() - interval '{days} days');")

    body = "\n".join(parts)
    grades = {key: a["grade"] for key, _d, a in assessments}
    print(json.dumps(grades, indent=0), file=sys.stderr)
    tpl = (HERE / "demo-seed.template.sql").read_text()
    workflow = (HERE / "demo-workflow.sql").read_text()
    out = tpl.replace("-- @@GENERATED@@", body).replace("-- @@WORKFLOW@@", workflow)
    (HERE / "demo-seed.sql").write_text(out)


if __name__ == "__main__":
    main()
