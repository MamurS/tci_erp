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

* **Sidebar, as in the Claude app (owner-specified details, Prompt 24):**
  pinned (w-64) or hidden — never an icon rail, and NEVER animated: pin,
  unpin and peek are instant (no slide, fade or width transition; the e2e
  test asserts `transition-duration: 0s` and no animation on the panel and
  its container).
  * **One toggle that never moves.** On a desktop the toggle is a single
    `SidebarToggle` in a fixed layer above everything (`AppShell`), 20px
    in and centred in the 64px top row, in every state — pinned, hidden,
    peeking. Only its colours follow what is behind it (light icon on the
    navy panel, navy icon on the white top bar); same icon, hit area and
    position. The panel's top row reads `[toggle] [TCI ERP]` and keeps a
    blank of the toggle's size where the fixed button sits; hidden, the top
    bar keeps the same blank.
  * **Peek.** Hidden, resting the pointer on the toggle or on the 8px strip
    along the left window edge for 100 ms (`PEEK_OPEN_MS`) shows the whole
    panel — logo, workspace switcher, items, badges — over the content,
    which does not move. It goes 300 ms (`PEEK_CLOSE_MS`) after the pointer
    has left both the panel and the toggle, on Esc, and on a click outside.
    A click on the toggle while peeking pins it in place.
  * **Keyboard and a11y.** The toggle carries `aria-expanded` and
    `aria-controls="app-sidebar"`, and comes before the panel in the
    document, so Tab goes from it into the menu; Enter on it pins; focus is
    never trapped. Ctrl/⌘ B pins and unpins. The tooltip («Показать меню» /
    «Скрыть меню» + the shortcut) opens below the button, never over the
    name.
  * Below 1024px it is a drawer (no animation either) with a backdrop that
    closes on navigation and on Escape, carrying its own toggle in the same
    spot. The pinned state is remembered per browser (`tci-erp-sidebar`).
    Logic: `layout/shell.ts`; acceptance: `e2e/shell/sidebar.spec.ts`.
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
RatingLegend (the ten-band scale), Combobox (typeahead), AmountInput,
LinkButton, ConfirmDialog, PasswordInput. Screens compose these — no ad-hoc
one-off controls.

**Every password field is a `PasswordInput`** — the `Input` with an eye
button laid over its right edge («Показать пароль» / «Скрыть пароль»,
`aria-pressed`, `aria-controls`, a `title`). The button is absolutely
positioned at a fixed size and the input reserves `pr-10`, so toggling moves
nothing; a form that stays on screen after a successful submit changes
`revealResetKey` to hide the password again. `passwordReveal.test.ts` refuses
a bare `type="password"` anywhere else.

### Interaction rules (owner review, October 2026)

Each was found on a real screen; `layoutContract.test.ts` enforces the
mechanical ones.

* **One action, one place.** An action is offered once per view — never in a
  section header AND in the empty state below it. A section with rows shows
  it in its header; while empty, the empty state carries it. A page-level
  action stays in the page header and the empty state only explains. A list
  emptied by filters says so and offers «Сбросить фильтры», not «create».
* **Pick from long lists by typing.** A company is chosen with `EntityPicker`
  (suggestions appear as you type — name or registration number, matching
  letters in bold, flag and country under each — and «Запросить
  организацию» when it is not there); a country with `CountryPicker` (any
  language or the ISO code). Never a listbox `<select size>`, never a native
  dropdown of the whole registry or of 249 countries. A filter lists only
  the values the data actually holds, with counts.
* **No box in a box.** Inside a Card or Panel an EmptyState and a Table drop
  their own frame (`FramedContext`).
* **A section header is one `SectionTitle`** with `hint` and `actions` — one
  height whether or not a button sits beside it, the button never hanging
  over the content, the same spacing everywhere. Never a hand-made
  `justify-between` row around it.
* **Confirmations are `ConfirmDialog`** (styled, translated, the button names
  the action) — never `window.confirm`. A button that navigates is a
  `LinkButton` — never `<a>` around `<button>`. Add-buttons carry a `Plus`
  icon, never a typed «+».
* **Escape closes the top dialog only**; in a picker it closes the list,
  not the dialog.
* **Dates are typed day first in `DateInput`** — a mask (ДД.ММ.ГГГГ /
  KK.OO.YYYY / DD/MM/YYYY) or a calendar in the interface language, Monday
  first, today from the Tashkent calendar — never the browser's
  `<input type="date">`, which showed «mm/dd/yyyy» in a Russian interface.
  The value is ISO. A contract test refuses `type="date"` anywhere else.
* **Lists fit a laptop.** At 1280px with the sidebar docked (≈960px of
  content) a list does not scroll sideways: names sit on one line in
  `Truncate` (full text on hover), the main text column is `cell-fill`
  (takes the width left and cuts there), numeric cells are `num` and never
  wrap.
* **Dialogs space their fields evenly** — the Modal body is a `gap-4` column;
  never `-mt-*` hacks; hints go in `Field`'s `hint`.
* **Every literal translation key exists** (`i18n/keysExist.test.ts`) — a
  missing one is printed raw on screen.

### Badges (owner rule, October 2026)

Grade, role, status, the Agenda's type tags, counters and chips are ONE
object (`src/components/ui/badgeStyles.ts`); only the colour tone varies.

| size | where | height | padding | text | weight |
|---|---|---|---|---|---|
| `sm` | tables, rows, running text, tab and sidebar counts, chips | 20 px (`h-5`) | `px-2` | 12 px (`text-xs`, leading 16 px) | medium |
| `md` | beside a page title (`PageHeader` / `DetailHeader` `status`) | 24 px (`h-6`) | `px-2.5` | 13 px (leading 20 px) | semibold |

* **One font: the body face (Inter)**, set on the badge itself
  (`font-sans`), so a badge never inherits the condensed display face of a
  heading it sits near.
* **One case: as translated, never capitals** (`normal-case`, set on the
  badge, so an uppercase heading cannot impose it). The labels are
  translated words in three languages; capitals make Cyrillic and Uzbek
  Latin with its ‘ wider and harder to read, the column reservations
  (`LABEL_SETS`) are measured in mixed case, and codes that are capitals
  (A1, ADT, NQL) stay capitals because they are written so.
* **One radius: the pill** (`rounded-full`), with an inset 1 px ring in the
  tone.
* **Counters** (`Count`: tab, sidebar and section counts) are the `sm`
  badge in counter form — its height, font, text size and weight, with the
  narrower counter padding (`px-1.5`) and a minimum width of two numerals,
  so 9 → 10 moves nothing.
* **Header badges sit beside the title, never inside the heading**: the
  `status` slot of `PageHeader` / `DetailHeader` centres them on the title
  (`items-center`) and makes them `md` through `BadgeSizeContext`.
* **Not a badge**: an avatar, the ISO code in place of a missing flag, and
  the Agenda's filter chips — toggle buttons, sized as a small Button.
* Anything that must be a button or a list item and look like a badge wears
  `badgeClassName(size, tone)` with `data-badge={size}`. `badges.test.ts`
  refuses `size="lg"` and hand-made pills; `e2e/layout/badges.spec.ts`
  checks on every guarded screen, in en / ru / uz, that badges of one size
  share one height (the spec's), that neighbours share a centre (±1 px), and
  that header badges are centred on the title.

### Side-by-side cards (owner rule, October 2026)

Cards placed next to each other end on one line. **A row of cards is a
`PanelGrid`** — never a hand-made `grid items-start lg:grid-cols-…`
(`layoutContract.test.ts` refuses one outside a short list of rows that are
not card rows, each with its reason).

* **Equal height.** The grid stretches its children: every card in a line is
  as tall as the tallest, its content stays top-aligned and the spare space
  stays at the bottom of the shorter card. Any child spans the row
  (`*:row-span-2`), so a plain `Card` (or a component whose root is one)
  stretches as a `Panel` does.
* **Bodies start on one line.** A `Panel` is a two-row subgrid (head, body):
  a two-line hint beside a bare title does not push one body down.
* **Footers on one baseline.** A Panel's `footer` (an action bar) is pinned
  to the bottom of its body, so the action bars of a row sit on one line at
  the bottom of the cards. A growable element in a body (a list, a preview, a
  textarea) may take the spare height with `h-full` instead.
* **Guarded.** `PanelGrid` marks itself `data-card-row`;
  `e2e/layout/cardRows.spec.ts` checks, on every screen the layout guard
  visits, at 1280 and 1920 and in en / ru / uz, that the cards sharing a top
  edge share their bottom edge (±1 px).

**Two panes** (Agenda → Triage) are the full-height variant: both panes
take the viewport's height below the header (`useFillViewport`), so their
bottoms always align; each scrolls inside itself under a pinned header, the
page never does, and the selected queue item is kept in view (J/K too).

Not card rows, and left as they are: a column of stacked sections beside a
card (the limit request), a document beside its side column (contract
draft, portal contract), the portal's policy list beside its next-steps
aside, and sections inside one card.

### No layout shift on interaction (owner rule, October 2026 — zero tolerance)

Hovering, clicking, opening a menu, a button starting to load, a status
changing, a count refreshing or the language switching **never moves or
resizes anything else** — not by one pixel. Checked in the browser by the
layout guard (`e2e/layout/`, every table/list screen × en/ru/uz × 1440 and
1280 px, fails on a move over 1 px) and on the source by
`layoutContract.test.ts` and `columns.test.ts`.

**Tables are fixed-layout with declared widths.** Copy this:

```tsx
import { Badge, Button, COL, RowActions, Table, actionsCol, labelCol } from '../../components/ui'

// One width per column, in order. COL.fill is the main text column (one,
// or two sharing equally): it takes what is left and cuts with an ellipsis.
const COLUMNS = [COL.code, COL.fill, labelCol('policyStatus'), COL.money, actionsCol(['edit'])]

<Table columns={COLUMNS}>
  <thead>
    <tr>
      <th>{t('policies.fields.number')}</th>
      <th>{t('policies.fields.policyholder')}</th>
      <th>{t('policies.fields.status')}</th>
      <th className="num">{t('policies.fields.maxLiability')}</th>
      <th><span className="sr-only">{t('common.actions')}</span></th>
    </tr>
  </thead>
  <tbody>
    {rows.map((r) => (
      <tr key={r.id}>
        <td className="font-mono">{r.policy_number}</td>
        <td>{r.name}</td>
        <td><Badge tone={tone(r.status)}>{t(`policies.statuses.${r.status}`)}</Badge></td>
        <td className="num">{formatAmount(r.amount, locale)} {r.currency}</td>
        <RowActions>
          <Button size="sm" variant="secondary">{t('common.edit')}</Button>
        </RowActions>
      </tr>
    ))}
  </tbody>
</Table>
```

* `<Table columns={…}>` lays the table out with `table-layout: fixed` and a
  `<colgroup>`: a column is exactly as wide as declared whatever its cells
  hold. Widths come from `src/components/ui/columns.ts`: `COL.date`,
  `COL.moment`, `COL.period`, `COL.amount`, `COL.money` (amount + currency),
  `COL.moneyShort`, `COL.code`, `COL.count`, `COL.days`, `COL.pct`,
  `COL.grade`, `COL.currency`, `COL.person`, `COL.pair`, `COL.review`,
  `COL.share`, `COL.icon`, `COL.fill` — or any CSS width. Several badges side
  by side: `labelsCol(['entityRole', 'entityRole'])`. Below the sum of the widths (plus 6rem for
  each fill column, `fillMin` to change it) the table scrolls sideways instead
  of crushing a column.
* **Cells keep to one line** and cut with an ellipsis; a cut cell names its
  full text on hover (`title`, set by the table itself). A cell that must wrap
  says so (`whitespace-normal`) — its row is then taller, but always the same
  height. **Headers are never cut**: they wrap between words (balanced, on the
  bottom line), so a column is sized for its content, not for a long
  uppercase caption; a single word longer than its column fails the guard.
* **Numbers**: `num` on the `<th>` and the `<td>` — right-aligned,
  `tabular-nums`, never wraps. Not on a text line (a key figure's label, a
  sentence with a number in it).
* **Status columns reserve their widest label in en, ru and uz:**
  `labelCol('claimStatus')`. Each vocabulary is a `LABEL_SETS` entry (its i18n
  keys and the length of its longest label); `columns.test.ts` reads the three
  locale files and prints the number to write when a translation outgrows it.
  A new status vocabulary in a column is a new `LABEL_SETS` entry first.
* **Action columns** are `<RowActions>` (the `<td>` itself — it never clips, so
  a focus ring or a menu is not cut) sized with `actionsCol([...labels], icons)`
  for the labelled buttons it can hold, each at its widest translation. A
  button that is not offered in this row is still absent from a column that
  is wide enough for it — the column never depends on the row.
* **When the buttons do not fit, the secondary ones fold into ⋯**
  (`ActionsMenu trigger="icon"`, destructive items last and in red): one
  primary button per row plus the menu. The menu is `fixed`, so it never
  grows a scrollbar on the table's card.
* **Revealed on hover by opacity, never `display`.** `<RowActions reveal>`
  fades its buttons in while the row is hovered or focused; their space is
  always taken. `hidden group-hover:flex` is the bug this rule exists for
  (the Agenda row used it: the title jumped left on every hover).
* **Loading stays inside the button's box**: the label keeps its place (a
  spinner replaces the icon or overlays the label), the button keeps its
  min-width. A row never grows a line while it saves; an error goes in a
  Callout above the table, not under the row.
* **Never a conditional column**: a cell with nothing to say renders «—» or
  stays empty — it is never left out of one row.

**Badges, chips, tab counts and sidebar badges reserve their width.**

* A number in a pill is `<Count value={n} />`: tabular digits in a box at
  least two digits wide, so 9 → 10 does not push its neighbour.
* A tab that counts passes `count: n || null` — `null` keeps the pill's place
  (invisible) while it loads or is zero; `undefined` is a tab that never counts.
* A toggle chip has its border in BOTH states (navy when pressed), and the
  same font weight: pressing it never changes its width.
* A Badge never grows past its cell: a label longer than its reserved column
  is cut with an ellipsis (and the guard fails on it — reserve more).
* Key figures and cards (`KeyFigures`, `StatCard`): values in tabular digits,
  so a refreshed figure keeps its width; the figures of one strip share one
  height (the grid stretches them), so a meta line under one of them does not
  make it taller than its neighbours.

**The guard** (`e2e/layout/layout.spec.ts`, part of `npm run test:e2e` and
CI). Screens come from the router: `e2e/layout/screens.ts` names every route
in `App.tsx` with the demo user who opens it, or the reason it has nothing to
guard — a new route fails the guard until it is listed. Their data is the
demo book, recorded once from canonical by the manual tool
`tools/layout-fixtures/record.mjs` (reads only; sanitised) into
`e2e/layout/fixtures/<role>.json`, and replayed by the stub with the network
**sealed** (`e2e/support/network.ts`): every `*.supabase.co` call is answered
by the stub, anything else that would leave localhost is aborted — never
continued or fetched — and the test fails if a request tried. The guard
never reaches canonical. For each screen, each tab found on it, en/ru/uz, 1440×900
and 1280×800: the boxes of every table (header, first row), the first row of
every `data-layout-row` list, every tab and toolbar chip are recorded; then
each first row is hovered and each control in it hovered, clicked and
dismissed with Escape (a disclosure is closed by a second click, and only what
lies below its row may move); any box moving or resizing by more than 1 px
fails, and so does a cut header word, badge, number, date or button, a table
that scrolls sideways or a tab strip that does (`LAYOUT_STATIC=1` runs only
these static checks, for calibrating widths). A list that is not
a table marks its rows `data-layout-row` to be guarded. Re-record after a
screen gains a query:

```sh
SUPABASE_ANON_KEY=… DEMO_PASSWORD=… \
  node --experimental-strip-types tools/layout-fixtures/record.mjs [role …]
```

### The rating scale

Score 1–100, lower is better. The ten-band presentation scale
(Exceptional … Insolvent, `src/lib/ratingScale.ts`) sits on top of the
engine's grade bands (A1 … D), which stay authoritative for authority and
limits. A score is "in" a band when it is less than 5 above the band's
decade, otherwise "between" that band and the next (72 → Weak; 78 →
between Weak and Distressed). Gauge, legend and report text all use that
one rule.

## The Agenda (`src/features/agenda`)

A queue to work, not a report. The page title keeps the house heading; under
it ONE live summary line (overdue in red, money at stake in UZS, today's
desk, cleared today). Right: List | Triage (`Segmented tone="solid"`,
remembered per person) and «Группировать: …» — in BOTH views (the triage
queue is grouped the same way), as wide as its widest choice, so neither
switching views nor picking a grouping moves the switch.

* **Chips**, not dropdowns: All, Assigned to me, then one per task family
  present, with live counts; the dashed «Отложенные» chip at the far right.
  State lives in the URL (`?family=&mine=1&snoozed=1`).
* **Groups**: one white card each, rows separated by hairlines; the header
  is a dot in the group's colour (red Overdue, amber Today, grey otherwise —
  every group has one), the name (red for Overdue), item and task counts, and the UZS sum (amounts without a rate are left out and said so).
  «Позже» starts collapsed.
* **Row** (~56px), on ONE grid shared by every row, sub-row and composer
  (`rowGrid.ts`: stripe · chevron slot · tag column · title + context · due
  · owner, every track fixed but the title's), so all titles start at one x
  in every group and language: a 3px left stripe (red overdue / amber today
  / neutral) — with the tag and the due label the only colour on the row —
  then the type tag in a column sized for the widest label with ⚡ (cut with
  a tooltip, never widened; ⚡ when automatic), the title «what · company», the context line
  (latest comment in italics with a count, or the system note, then the facts
  in tabular numerals), the relative due label (date in the tooltip) and the
  owner avatar. The whole row is a stretched link to the OBJECT; hover or
  keyboard focus reveals the actions. A keyboard-focused row has an inset
  navy ring.
* **Triage**: two panes as tall as the viewport below the header, ending on
  one line, each scrolling inside itself under a pinned header (the page
  never scrolls; the selected queue item is kept in view): the queue
  (≤ 22rem, sticky group headers) left, the task right — pinned: tag + due,
  title, provenance, the «Перейти к …» button with the destination spelled
  out under it; scrolling: the comment thread (system note muted), the
  family panel, the history. Handled rows stay struck through until reload.
* **Contrast**: every text ≥ 4.5:1. The amber token is not used for text.

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
generated from the «Договор» tab of a policy or the submission page into the
in-app editor (see «Contract drafts» below); .docx files generated before
that stay listed under «Ранее сформированные файлы».
Templates and the contract register are tabs of «Полисы» («Реестр
полисов» / «Договоры» / «Шаблоны договоров»), not sidebar items of their own.

## Contract drafts (viewer, editor, comparison)

A draft contract reads like paper and works like an object page
(`src/features/contracts`, migration 0057).

* **The «Проект договора» section** (policy «Договор» tab, submission page —
  full width) is the draft's version table: Версия · Статус · Сохранена ·
  Автор · Происхождение и шаблон · actions. Fixed widths: the status column
  reserves «Ko‘rib chiqilmoqda» (`contracts/columns.ts`, tested), the actions
  are four icon buttons — view, edit (current version, editable statuses
  only; otherwise its place stays empty), compare with the previous version,
  and the «Скачать» menu (DOCX / PDF) — so the table fits 60rem. Older
  versions show the status they last reached, or «—».
* **One layout for viewer, editor and comparison:** `DetailHeader` (eyebrow
  «Проект договора», the CD- number, the status badge, links to the policy or
  submission, the template and language; actions: the next status step as the
  one primary button, «Редактировать», «Скачать ▾», «Действия ▾»), then the
  callouts (signed, agreed, older version, stale fields, schedule changed,
  shared, conversion warnings), then two columns: a 17rem side column (the
  contents — headings and clauses with their numbers, click to jump — the
  comments, the status history) and the sheet. Below 1280px the sheet comes
  first.
* **The sheet** is page-like: white, a hairline border, `max-width: 210mm`,
  padding from the template's margins, the template's font (Arial → Arimo)
  and size. Clause numbers are drawn, not typed. Merge fields are chips (pale
  blue with a blue underline); a field whose source has moved is AMBER with a
  ring and the callout says how many; an empty field shows its path in grey
  italics on screen and nothing on paper or in the portal.
* **The editor** keeps the same sheet with a sticky compact toolbar above it
  (undo/redo · paragraph style: text, numbered clause, numbered section,
  heading, document title · bold/italic/underline · align left/centre/justify
  · bulleted/numbered list · table insert, row, column, «Таблица…» menu ·
  page break · «Вставить поле…» · field → text). Nothing in the toolbar
  appears or disappears with the selection — controls disable instead — so it
  never reflows. A status line above it says what the edit is based on and
  whether there are unsaved changes (with the time of the local copy);
  «Сохранить версию» (⌘S) asks for an optional change note.
* **The comparison**: two version pickers, «В тексте | Рядом», a one-line
  summary with the legend. Insertions are green AND underlined, deletions red
  AND struck through, changed lines carry an amber left rule — never colour
  alone. Side by side keeps the two columns aligned with blank lines; a clause
  that only moved number is not a change (its old number is the tooltip).
* **Print / PDF** is a bare page with a navy toolbar (back, «Печать или
  сохранение в PDF»); `@page` uses the template's size and margins and prints
  «page x of y» at the bottom in the document's language.
* **The portal** lists the shared drafts and shows the selected one as a
  plain sheet with «Ваши комментарии» beside it (a comment box only while
  under review).

## Commercial offers and the brochure (`src/features/offers`, `src/features/brochure`)

One document, three faces: `OfferDocument` renders the offer on the portal,
in the staff print preview and on A4 (`/requests/offers/:id/print`,
`/portal/offers/:id/print`); `BrochureBody` renders the brochure in the
editor preview, the portal and the appended print pages. Never fork either.

* **The document's language, not the UI's.** Every label comes from
  `useFixedT(offer.language)`; country names from `tci.countries` in that
  language; amounts through `formatDocumentAmount`.
* **Print rules.** A4, 16/15/18/18 mm margins, «page x of y» in the `@page`
  margin box from `pageCounterContent`, no footer on the cover. The cover
  breaks after itself, the brochure starts on a new page. Terms and premium
  tables are kept whole; the buyer table may run over pages, repeats its
  header and never splits a row; an amount never wraps (`white-space:
  nowrap`, widths from the `colgroup`). Brochure sections FLOW — a section
  kept whole left half-empty pages — while a heading stays with its text and
  the diagram, an image and each FAQ question with its answer stay whole.
* **Auto-print waits** until every image has settled and the fonts are in
  (10 s cap), so a PDF never captures an empty picture box.
* **Basis badges** on buyer limits: approved = positive, indicative = neutral,
  declined = negative, with the footnote that only approved limits are
  decisions. A grade, an engine limit or an authority never appears.
* `e2e/offers/print.spec.ts` prints the offer with the brochure in ru/en/uz
  through the sealed stub (`OFFER_PDF_DIR` keeps the PDFs).

## Financial data display rules (apply everywhere)

* Numbers **right-aligned** with `tabular-nums` — use the `num` utility class.
* Separators (owner's decision, 2026-10-21): **comma between thousands,
  point for decimals — `1,234,567.89` — in every UI language**, on screen,
  in reports and while typing (`THOUSANDS_SEPARATOR` / `DECIMAL_SEPARATOR`
  in `src/lib/format.ts`, the only formatter — never `toLocaleString`
  inline). The one exception is a generated LEGAL document (policy
  wording), written in its language's national notation
  (`formatDocumentAmount`: `1 250 000,00` in ru/uz). Compact amounts
  (`formatCompact`: 261.37B / 261.37 млрд) for prose and key figures; full
  amounts in statement tables. A numeric table cell never wraps.
* Amounts are TYPED in `AmountInput`: grouped as you type, caret kept,
  right-aligned, the currency (or %, days) inside the field as a suffix —
  never in the label as well. A value that rounds to
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
