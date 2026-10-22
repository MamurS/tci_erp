# UX/UI audit — October 2026

**Method.** Every screen and every top-level tab was captured full-page at
1440 px, with scrollbars shown, against the demo book on the canonical project:
82 screenshots across six roles (commercial and credit underwriter, claims,
sales, information manager, client portal). Four reviewers each took one group
of screens and traced every defect to the component that draws it. A headless
check then measured, on every tabbed screen, whether the title and the tab
strip move when the tab changes, and whether neighbouring panels start their
contents on one line. The admin screens were reviewed in code only: an admin
session needs MFA, which a headless login cannot pass.

**Status.** ✅ fixed in this round · ⏳ open, in the backlog below.

## 1. Systemic defects (each affects many screens)

| # | Defect | Where | Severity | Status |
|---|---|---|---|---|
| S1 | **Content moves when the tab changes.** A short view has no scrollbar and a long one does, so everything centred or right-aligned jumps by the scrollbar's width. 19 tabs were affected. | every section with tabs | high | ✅ `scrollbar-gutter: stable` |
| S2 | **Title position differs between sections.** «Полисы» and «Кредитные лимиты» narrowed themselves to `max-w-7xl`. Claims, declarations and overdues added their own `p-6`. | 5 sections | high | ✅ one content width |
| S3 | **Neighbouring panels start their tables at different heights** when only one of them has a hint. | portfolio, monitoring, authority | high | ✅ `PanelGrid` / `Panel` (CSS subgrid) |
| S4 | **A bare `<Card>` has no padding, so text sits on the border.** About 50 call sites. | claims (all tabs), declarations, overdues, premium, portal | high | ✅ + contract test |
| S5 | **Number columns have left-aligned headers.** `[&_th]:text-left` outranked `text-right` on specificity. | every table | high | ✅ `:where()` |
| S6 | **Raw i18n keys on screen.** `agenda.taskTypes` lacked the 16 task types added in phases 4–6; `agenda.tasks.buyer_proposed` was missing. | dashboards, Agenda | high | ✅ + contract test |
| S7 | **Three date formats, sometimes in one card:** ISO `2026-10-10`, `2026-10-18 12:04`, and `11/10/2026, 17:02`. A date-only due date was shown as «05:00». | everywhere | high | ✅ `formatDate` / `formatMoment` / `formatDue` / `formatPeriod` + contract test |
| S8 | **Card headings came in two styles:** the brand `SectionTitle` and a plain grey `h2`/`h3`. | ~50 headings | medium | ✅ |
| S9 | **Key figures were built three ways,** with labels on the left and values pushed right (the `num` utility), zig-zagging when a date sat next to an amount. | claim, premium, overdue, declaration, group | high | ✅ `KeyFigures` |
| S10 | **No action hierarchy.** Up to five equal buttons in a header, destructive ones solid red beside neutral ones, seven orange buttons on one screen. | claim, policy, contracts | high | ✅ (the account page's two primary buttons are in the backlog) |
| S11 | **A table inside a card draws a double frame.** | registers inside cards | medium | ✅ + contract test |
| S12 | **Identifiers, dates and amounts wrap mid-token** (`TCI-2026-` / `0007`), while free-text columns waste width. | registers, queues | high | ✅ `nowrap` on head and codes |
| S13 | **Signed zero:** «−0,0%» in red, «+0,00x ▲», «fell from 56,0% to 56,0%». | risk report, financials | medium | ✅ |
| S14 | **The grade is shown twice in a cell** («C C2»). | limits hub, queue | low | ✅ |
| S15 | **English UI says «Bayer»** (the ru/uz term) 20 times. | en locale | medium | ✅ «buyer» |
| S16 | **Developer text reaches users:** «котировки — позже», «Запустите его (services/analytics)». | registry, client access | medium | ✅ |
| S17 | **Two table styles with no rule.** | various | medium | ⏳ the dense table is used inside panels; a full pass over the registers is in the backlog |

## 2. Bugs found by the audit

| Bug | Where | Status |
|---|---|---|
| The premium rate is shown 100× too high: «18,0%» for 0,18%. | policy «Премия» tab, portal «Премия» | ✅ |
| A limit card is headed by a raw UUID when the scope is a submission. | company «Лимиты» tab | ✅ |
| Two portal columns are both headed «Запрошено» (one amount, one date). | portal «Лимиты» | ✅ |
| The submission page's right column overflows the gutter (`3fr_2fr` with no `minmax(0,…)`). | submission page | ✅ |
| A company's «Полисы» tab says «нет полисов» while it loads. | company card | ✅ |
| The «Дней до пересмотра» column shows the text «до пересмотра» where there is no date. | limits in force | ✅ |
| Task parameters such as `106.3%` and ISO dates are interpolated raw. | dashboard, Agenda | ✅ |

Also fixed: the portal's navy header now runs into the reserved scrollbar
gutter, and a title with a button beside it sits on the same line as a bare
title in the next panel.

## 3. Screens rebuilt

- **Claim**: one header, with the buyer as the title and the claim number, policy, policyholder and group in the meta line. The next step is the primary button; destructive actions come last, in red text. A single key-figure strip. Callouts for a late notification and for missing documents. The overview is two aligned panels of label → value facts. Every tab is padded.
- **Declaration**, **overdue notification** and the **policy «Премия» tab** are rebuilt on the same primitives.
- **Policy overview**: the 19 cards become four headline figures, then one table with a row per currency and inline bars for paid share and loss ratio. The three half-empty breakdown panels become one «Структура портфеля» panel, and a loss ratio has one colour rule everywhere.
- **Credit overview** and **limits in force**: one figures strip instead of five tall cards. «Нет курса UZS» appears only when it is not zero.
- **Claim documents**: a checklist with ✓ and «нет» per required document, and a files panel with a styled upload button replacing the native «Choose File» input. Removing a file is a quiet icon.
- **Claim invoices**: only the reasons that DECIDED a verdict are shown. «Covered by an approved limit» no longer appears under «Not covered». «Re-check coverage» is offered only while the claim is being assessed.
- **Claim indemnity**: before approval the result is labelled «Расчётное возмещение (ещё не признано)». It closes the table it is derived in.

## 4. Backlog (recorded, not done in this round)

- A portal home page («Обзор») with the client's key facts; today the client lands on a single policy row.
- Hints (info tooltips) for insurance jargon in the portal: NQL, aggregate first loss, waiting period, uncovered excess.
- A localised date picker instead of the browser's `mm/dd/yyyy`.
- A sticky save bar on the 4 900 px statement form and the policy form.
- A «⋯» overflow menu primitive for secondary and destructive actions.
- Claim overview: a status stepper (filed → review → decision → paid).
- The submission page: crushed buyer column; a disabled «В андеррайтинг» gives no reason.
- Statement entry form: the shorter P&L card stretched to the balance sheet's height; subtotal lines shown as editable inputs.
- The rating tab: raw engine decimals in «Значение»; the gauge, bar and legend show the same score three times.
- Registers: request numbers right-aligned under a left «№»; the default tab of «Заявки» is the empty «Мои черновики».
- Dashboard: a credit-centred KPI strip for the credit desk; a claims-specific list for the claims desk.
- Credit-centred KPI strip on the credit underwriter's dashboard.
- The risk-report chart axis ticks (0 / 2.5 / 5 rounded to 0 / 3 / 5).
- The group tab of a standalone company: one empty state instead of five near-empty panels, and the «no statements» note that ignores the company's own statements.
- Premium schedule: a 12-month policy produced 13 instalments with two on the same date (check `generate_premium_instalments`).

## 5. Terminology for the owner to decide

None of these is in the glossary, so no wording was picked:

- **Claims section name.** The sidebar says «Убытки»; the page and tabs say «Требования о возмещении» / «Требования».
- **NQL** appears as «Некредитуемый», «Некомпенсируемый» and «Не подлежащий возмещению» убыток.
- **Insured percentage** appears as «Страховое покрытие, %», «Процент страхового покрытия» and «Застрахованная доля».
- **Aggregate first loss** appears as «Совокупная» and «Агрегатная франшиза».
- **Deductible** appears as «Франшиза по убытку» on the overview and «Минус франшиза» in the indemnity trace.
- **«Нетто-позиция страховщика»** needs a hint for claims handlers.
