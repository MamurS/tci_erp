# TCI ERP Design System

Light theme, corporate credit-insurance look modelled on the Delcreda style:
navy and process blue with an orange accent, a condensed display face for
titles and figures, and the risk report as the reference document. Implemented
with Tailwind CSS v4; tokens live in `src/index.css` under `@theme` and are
the single source of truth.

**The look is Delcreda's, the name is neutral.** The wordmark, the copyright
line and the (optional, currently empty) legal block come from
`src/lib/brand.ts` — "TCI ERP". No insurer's or vendor's name appears on a
screen, a report, the page title or a placeholder; re-brand by editing that
one file.

## Tokens

### Color

Measured from the reference risk reports.

| Role | Token / Tailwind class | Value |
|---|---|---|
| Page background | `body` | `#f3f6f9` |
| Surface (cards, tables) | `bg-white` | `#ffffff` |
| Brand navy (Pantone 2955) — titles, primary buttons, table heads | `accent-600` / `brand-navy` | `#005288` |
| Process blue — section markers, rules, focus | `accent-500` / `brand-blue` | `#0093d0` |
| Orange — the one call-to-action per screen (`Button variant="accent"`) | `brand-orange` | `#f7941e` |
| Amber — warnings on navy, overdue counts in the hero | `brand-amber` | `#fcaf17` |
| Highlight / subtotal rows | `accent-100` | `#dceff8` |
| Zebra / tinted panels | `accent-50` | `#f2f8fc` |
| Card / table border on tinted panels | `accent-200` | `#c9dde9` |
| Ink (black 90%) | `ink` | `#191919` |
| Muted (black 60%) | `ink-muted` | `#666666` |
| Positive dynamics | `pos-500` | `#2e8b3e` |
| Negative dynamics / errors / negative numbers | `neg-500` | `#d62828` |
| Validation warnings (non-blocking) | `warn-500` / `warn-50` | amber |
| Rating scale (pairs 10/20 … 90/100) | `scale-1` … `scale-5` | `#17b81a` `#a6c419` `#f2a900` `#f2661a` `#ee1c1c` |

Green / red are reserved for *meaning* (dynamics, validation), never
decoration. Orange is reserved for the single most important action on a
screen.

### Typography

* `font-sans` — Inter Variable: UI body, forms, tables on screen.
* `font-display` — PT Sans Narrow: page and section titles (uppercase navy),
  table heads, labels, key figures and the wordmark.
* `font-report` — Arimo (metric-compatible with Arial): the body of the
  printed risk report.

Scale: page title `font-display text-[28px] uppercase`, section title
`SectionTitle` (17px uppercase with a blue square), body `text-[14px]`,
dense table `text-[13px]`, caption `text-xs text-slate-500`.

### Spacing & radii

Tailwind default 4px spacing scale. Main area `max-w-[1480px] px-6 py-7`;
card padding `p-5`. Radii: controls `rounded-md` (6px), cards `rounded-lg`
(10px), modals and the dashboard hero `rounded-xl` (14px). Shadows:
`shadow-card` at rest, `shadow-pop` on hover and for overlays.

## App shell

* **Sidebar, Claude-style:** docked (w-64) or hidden — never an icon rail.
  The toggle sits in the top-left corner in BOTH states (the docked panel's
  header, the top bar when hidden — same coordinates). While hidden, resting
  the pointer on that toggle slides the panel out from the left edge, full
  height BELOW the top bar (as in the Claude desktop app), so the toggle
  stays clickable and a click docks it; leaving the toggle and the panel
  slides it away. Nothing else peeks it:
  no left-edge strip, no pin button. Ctrl/⌘ B toggles. Below 1024px it is a
  drawer with a backdrop that closes on navigation and on Escape. The state
  is remembered per browser (`tci-erp-sidebar`). Logic: `layout/shell.ts`.
* **Role workspaces:** the top of the sidebar is the workspace switcher
  (icon, «Рабочее пространство», the workspace name; a list when the person
  has several). Below it «Общее» (dashboard, agenda, companies), then the
  workspace's own tools under its name. Switching lands on the workspace's
  first tool (`workspaces.ts`).
* **Sections with views:** a desk's section is one sidebar item with tabs
  under the page header (`?view=`), never several items: «Полисы» (Обзор ·
  Реестр полисов · Договоры · Шаблоны договоров) and «Кредитные лимиты»
  (Обзор · Очередь решений · Действующие лимиты · Мониторинг · Рейтинги ·
  Группы · Мои полномочия). The section is a `SectionPage`: ONE header (the
  section's title and subtitle) and ONE tab strip, which stay exactly where
  they are whatever the view — same width, same height, measured headlessly
  in every view. A view never renders its own `PageHeader`: its one-line hint
  and its actions (a filter switch, its primary button) go in a `ViewBar`
  under the tabs. Views load lazily inside the section's own Suspense, so the
  header and tabs never blink while one loads. A tab may carry a count. A
  sub-choice inside a view (the request queues) is a `Segmented` control, so
  two rows of tabs never stack. The tab rule is an inset shadow, so the strip
  never overflows vertically (no stray scrollbar).
* **An object page** (a claim, a declaration, an overdue notification, a
  policy) is composed from `components/ui/detail.tsx`, never hand-built:
  `DetailHeader` (eyebrow naming the kind of object, the title, the status
  badge beside it, a meta line of links joined by dots, the actions);
  `KeyFigures` (the few numbers that matter, in ONE card divided by
  hairlines, every cell left-aligned the same way; `text` for a word such as
  a cause of loss; `muted` for "not yet"); `DescriptionList` (label → value
  rows, tabular figures, `columns={2}` instead of stretching a label away
  from its value); `Callout` (what needs attention, amber when it can wait,
  red when it blocks, with the action as a link).
* **Actions have a hierarchy.** One primary button (the next step), then
  secondary ones, the edit, and destructive actions LAST as `dangerOutline`
  (red outline; the filled `danger` is for the confirm button of their
  modal). The orange `accent` is one call to action per screen at most —
  never one per table row. An action inside a table row is a text button or
  an icon, so rows with an action are as tall as rows without.
* **Cards and tables.** A `Card` has no padding of its own: every Card states
  one, or is a flush `overflow-hidden` frame whose rows pad themselves. A
  `Table` draws its own frame and is never wrapped in a Card. Table heads do
  not wrap; identifiers, dates and amounts do not wrap; numeric heads are
  right-aligned over right-aligned numbers. `layoutContract.test.ts` checks
  the first two on the source.
* **One date format.** `formatDate` (05 Oct 2026 / 05 окт. 2026 /
  05-okt 2026) and `formatMoment` (the same + time) everywhere; `formatDue`
  shows a midnight-UTC deadline as a date (never "05:00"); `formatPeriod`
  names a month or quarter («сентябрь 2026»); `formatRate` reads a premium
  rate stored as a percentage (0.18 → 0.18%, never 18%). No ISO string is
  sliced for display (`layoutContract.test.ts`). A change that rounds to zero
  has no sign, arrow or colour.
* **Nothing moves between views or sections.** `html` reserves the
  scrollbar's gutter (`scrollbar-gutter: stable`): a short view (a 7-row
  register) and a long one (an overview) would otherwise differ by the
  scrollbar's width and every centred or right-aligned element would jump.
  Every page, sections included, uses the shell's full content width — no
  page narrows itself with its own `max-w-*` except a form (password,
  statement entry). Verify headlessly with scrollbars SHOWN: Playwright passes
  `--hide-scrollbars` by default, which is exactly what hides this shift
  (`ignoreDefaultArgs: ['--hide-scrollbars']`).
* **Top bar:** sidebar button (when hidden), the current section (icon +
  name), the command palette (Ctrl/⌘ K — companies by name or registration
  number, plus every destination the caller's roles allow; icon-only below
  640px), language switcher, account menu.
* **Pages load lazily**, one chunk per feature module (`lib/lazyPage.ts`),
  with a skeleton inside the shell while a chunk arrives. Only the Russian
  strings are bundled; en / uz are fetched on first use (`i18n/index.ts`,
  `useFixedT` for a report printed in another language).
* **Flags** are SVG (`CountryFlag`), loaded per country — Windows does not
  draw emoji flags.

## Dashboard

Work first, not a wall of cards: one KPI strip (each figure links to its
screen), the caller's own Agenda worst-first ("Требует вашего внимания"),
and a signals column listing only what is not zero (`pages/dashboard.ts`).

## Core components (`src/components/ui`)

Button (primary navy / accent orange / secondary / ghost / danger, sizes
md·sm), Input, Textarea, Select, Field (uppercase label + hint), Segmented,
Card, Table (dense financial variant: navy head, zebra rows), Tabs (with
counts), Badge, Modal, EmptyState (with icon), PageHeader (eyebrow + display
title), SectionTitle, StatCard (key figure with a coloured top rule and
tone), Skeleton, Spinner, BrandMark, GradeScale (engine grade bands),
RatingGauge (semicircle 0–100 with needle and change vs previous) and
RatingLegend (the ten-band scale). Screens compose these — no ad-hoc
one-off controls.

### The rating scale

Score 1–100, lower is better. The ten-band presentation scale
(Exceptional … Insolvent, `src/lib/ratingScale.ts`) sits on top of the
engine's grade bands (A1 … D), which stay authoritative for authority and
limits. A score is "in" a band when it is less than 5 above the band's
decade, otherwise "between" that band and the next (72 → Weak; 78 →
between Weak and Distressed). Gauge, legend and report text all use that
one rule.

## The risk report (`src/features/entities/report`)

Two faces, one document: `useRiskReport` assembles the data,
`RiskReportBody` lays it out. The A4 route `/entities/:id/report` renders it
in the print sheet; the company card's **Overview tab renders the same
document on screen** (`.rpt-embedded`: larger type, stacking below 1100px,
wide tables scroll inside the sheet; conclusion and factor bullets drill
into their tab).

One document for screen and PDF, styled by `report.css` (scoped `.rpt-*`):
A4 sheet, running header (wordmark, RISK REPORT, name | registration
identifier, report date) repeated on every printed page, footer in the
`@page` margin boxes with "page x of y". Section order: general information
+ gauge and factor bullets → scale legend → freshness banner → key figures
→ conclusion + overall assessment → group key companies → balance sheet
(company, COMBINED group, commentary) → P&L → ratio tables → dynamic graphs
→ risk summary → group exposure → glossary → group structure → disclaimer
→ end of report → legal block. Numbers come from `report/model.ts`,
sentences from `report/commentary.ts` and `report/narrative.ts`, never
from the component.

## National forms and IFRS

Statements are typed on the national form of the buyer's country (official
line codes, captions in the UI language with the original caption beneath,
"(−)" on deduction lines, live amber checks of the form's own totals and of
the IFRS cross-checks) and are always ANALYSED and SHOWN in IFRS: every
table, ratio, chart and report reads the mapped IFRS rows. The national form
stays reachable as «исходная форма» — the audit trail of what was typed —
and the statement badge names its framework (РСБУ, HGB, US GAAP…).

## Contract templates

«Шаблоны договоров» lists the insurer's .docx templates with status badges
(draft amber, active green, retired neutral), the insurer's particulars and
the placeholder reference (monospace, select-all). A draft contract is
generated from the «Договор» tab of a policy or the submission page; the
history of generated documents stays beside the button.
Templates and the contract register are tabs of «Полисы» («Реестр
полисов» / «Договоры» / «Шаблоны договоров»), not sidebar items of their own.

## Financial data display rules (apply everywhere)

* Numbers **right-aligned** with `tabular-nums` — use the `num` utility class.
* Thousands separator: space; decimal comma for ru/uz, standard `1,234.56`
  for en (`src/lib/format.ts` is the only formatter — never `toLocaleString`
  inline). Compact amounts (`formatCompact`: 261.37B / 261,37 млрд) for prose
  and key figures; full amounts in statement tables. A value that rounds to
  zero never prints as "-0".
* Negative values: red (`text-neg-500`) with a minus sign.
* Percentages: 1 decimal place on screen, 2 in the report.
* Dynamics: ▲/▼ indicator; **green means improvement, red means
  deterioration** — direction-aware: for expense, liability and debt lines an
  increase is deterioration (red ▲). Line directions are declared in
  `src/features/entities/financials/lines.ts`. The report follows the same
  rule (it deliberately does NOT colour every rise green).
* Changes are always read from the ORIGINAL statement currency, even when
  amounts are shown converted, so an exchange-rate move never reads as
  business dynamics.
* Null / absent values render as "—", never as 0.
* Subtotal rows bold; grand totals bold on the `accent-100` highlight.

## Validation style

Non-blocking accounting-equation warnings are amber (`warn-*`), never red;
red is reserved for hard errors. Warnings do not prevent saving — the
analyst's entered figure is the source of truth.
