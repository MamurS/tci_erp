# Statement frameworks — the national forms behind manual entry

Each `*.json` here is the editable SOURCE of one accounting framework: its
balance sheet and income statement templates, line by line, with the form's
own arithmetic, its cross-checks against the computed IFRS totals and its
line → IFRS mapping. The migrations load them through
`tci.seed_statement_framework(jsonb)` (0049); the migration text is what the
database holds, and `frameworkSeeds.test.ts` fails when a document here and
the one in the migrations differ.

To add a country or fix a form:

1. edit or add `XX_FRAMEWORK.json` (the format is below);
2. `python3 supabase/frameworks/validate.py supabase/frameworks/XX_FRAMEWORK.json`
   until it prints OK — including the numeric test (random leaf values →
   the form's formulas → the mapping → every checked total reconciles);
3. `python3 supabase/frameworks/build_migration.py 00NN_name XX_FRAMEWORK`,
   write the What/Why header, replay, `npm test`.

The loader is idempotent and never removes or re-keys a line: values already
entered against a template keep their line ids. Lines whose official code or
caption could not be confirmed carry a note "to be verified".

---

TCI ERP (trade credit insurance, Tashkent) analyses buyers' financial statements
in ONE canonical IFRS layout. Analysts type a buyer's statutory statements
exactly as printed on that country's official forms; each form line is mapped
to an IFRS column, and the app computes IFRS subtotals and cross-checks them
against the form's own totals. You author one JSON file per accounting
framework: one balance sheet template + one income statement (P&L) template.

Worked example: `UZ_NAS.json`. Validate every file with `validate.py`
until it prints `OK`. The validator also runs a numeric test:
random values in leaf lines → your formulas → your mapping → IFRS totals must
equal every line you marked with `check`. A failure there means double
counting, a missing mapping, or a wrong sign — fix the data, never delete the
check to make it pass unless the difference is a genuine, documented IFRS
reclassification (say so in that line's `note`).

## File shape

```json
{
  "framework": {
    "code": "RU_RAS",                       // UPPER_SNAKE, unique
    "kind": "national_gaap",                // or "ifrs_based"
    "short": {"en": "RAS", "ru": "РСБУ", "uz": "RBHS"},   // badge, <= 12 chars
    "name": {"en": "...", "ru": "...", "uz": "..."},
    "legal_basis": "Приказ Минфина России от 02.07.2010 № 66н (ОКУД 0710001/0710002)",  // in the original language
    "countries": ["RU"]                     // ISO alpha-2 that use this framework for statutory accounts
  },
  "templates": [ {balance sheet}, {income statement} ]
}
```

Template:

```json
{
  "code": "RU_RAS_BS",                       // <FRAMEWORK>_BS / <FRAMEWORK>_PL
  "form_kind": "balance_sheet",              // or "income_statement"
  "fidelity": "official_codes",              // see below
  "local_language": "ru",                    // ISO 639-1 of the official form
  "name": {"en": "...", "ru": "...", "uz": "...", "local": "..."},
  "lines": [ ...in the order printed on the form... ]
}
```

`fidelity`:
* `official_codes` — `code` is the line number printed on the statutory form
  (Russia 1110…, Belarus 110…, Ukraine 1000…, Turkey account groups 10…).
* `prescribed_captions` — the law prescribes the captions and their order but
  has no line numbers (HGB §266, Directive 2013/34/EU Annex III, China CAS
  format, Japan, India Schedule III, Brazil Lei 6.404). Use the statute's own
  reference as the code where one exists (HGB `A.I.1`, Directive `C.II.1`),
  otherwise short stable codes you assign (`R01`, `R02`…).
* `framework_layout` — no prescribed format at all (US GAAP): the customary
  classified layout; codes are yours.

Line:

```json
{
  "code": "1150",
  "section": "assets_long_term",
  "indent": 0,                 // 0 = top level, 1 = component, 2 = sub-component
  "subtotal": false,           // true for totals/subtotals printed on the form
  "negative": false,           // true when the line is a DEDUCTION shown in parentheses
                               // or with a minus on the form: the analyst types it as a
                               // POSITIVE number, and formulas put it in "minus"
  "name": {"en": "...", "ru": "...", "uz": "...", "local": "<exact caption on the official form, original language>"},
  "map": {"column": "property_plant_equipment", "sign": 1},   // or null
  "formula": {"plus": ["1110", "1120"], "minus": []},        // or null
  "check": "total_non_current_assets",                         // or null
  "note": "why it is unmapped / any reclassification"          // or null
}
```

Rules:

1. `section`: balance sheet → `assets_long_term`, `assets_current`, `equity`,
   `liabilities_long_term`, `liabilities_current`. Income statement →
   `operating`, `financial`, `result`. Nothing else (they are UI i18n keys).
   For a form that lists equity after liabilities, keep the form's order — the
   section of each line is what matters.
2. Every line that is a total or subtotal on the form: `subtotal: true` AND a
   `formula` with its official arithmetic. A non-subtotal line may also have a
   formula when the form defines it from components (net book value = cost −
   depreciation).
3. Map LEAF lines, never a total AND its components both — that double
   counts. Typically: map the components and leave the total to its formula;
   or, when components are only a partial "including" (в том числе) breakdown,
   map the total and give the breakdown lines `map: null` + a `note`.
4. Every line with neither `map` nor `formula` needs a `note` (memo,
   "including" breakdown, not a balance sheet amount, etc.).
5. Sign convention of the IFRS columns: EXPENSES are stored POSITIVE
   (`cost_of_sales`, `distribution_expenses`, `administrative_expenses`,
   `other_operating_expenses`, `finance_costs`, `income_tax`).
   `other_operating_income`, `finance_income` positive. `other_non_operating`
   is signed (income +, expense −). Equity deductions (own shares, unpaid
   capital, accumulated losses typed positive) map with `sign: -1`. A
   `negative: true` expense line typed positive maps to an expense column with
   `sign: 1`, or to `other_non_operating` with `sign: -1`.
6. `check`: put it on the form's own totals that correspond to an IFRS
   computed total. Balance sheet totals: `total_non_current_assets`,
   `total_current_assets`, `total_assets`, `total_equity`,
   `total_non_current_liabilities`, `total_current_liabilities`,
   `total_liabilities`, `total_equity_and_liabilities`. P&L: `gross_profit`,
   `operating_profit`, `profit_before_tax`, `net_profit`. At least total
   assets / total equity-and-liabilities and net profit. Only check what
   genuinely reconciles.
7. A form that splits "profit" and "loss" into two lines (Ukraine 2190/2195):
   model the profit line as the signed result with the formula, and give the
   loss line `map: null`, no formula, and a note ("loss variant of 2190: type
   the result as a negative number in 2190").
8. Do NOT invent official line numbers. If you are not certain of a code on an
   `official_codes` form, still use your best knowledge but add
   `"note": "code to be verified"` — the owner reviews flagged lines. Names
   must be the real captions.
9. Languages: `en` clear English; `ru` Russian; `uz` Uzbek in LATIN script
   with the apostrophe U+2018 only: o‘, g‘ (the validator rejects ' ’ ` ʻ ʼ).
   `local` = exact caption in the form's own language (German, French,
   Chinese, Japanese, Turkish, Portuguese, Ukrainian, Russian…).
   Owner-dictated uz terms: risk → Qaltislik; deductible → Franshiza;
   company/organisation → Tashkilot. Typical uz accounting vocabulary used in
   UZ_NAS.json: Asosiy vositalar, Nomoddiy aktivlar, Tovar-moddiy zaxiralar,
   Debitorlik qarzlari, Kreditorlik qarzlari, Pul mablag‘lari, Ustav kapitali,
   Taqsimlanmagan foyda, Sotishdan tushgan tushum, Sotilgan mahsulot tannarxi,
   Yalpi foyda, Foyda solig‘i, Sof foyda, Kreditlar va qarzlar, Zaxiralar.
10. Keep the forms complete at the level the statute prescribes for a normal
    commercial company (the long form, not the micro/SME abbreviated one),
    typically 30–60 balance sheet lines and 15–35 P&L lines.
