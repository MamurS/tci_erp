# Redesign progress (Prompt 30)

The reference is `docs/design-research-2026-10.md`. One branch
(`claude/buyer-dashboard-overview-pps7lk`), one PR, one commit per phase
(`redesign: phase N — …`), so a phase can be reverted on its own. A new
session resumes from this file and the branch.

## Phase 1 — Foundations (tokens) — done

* **Colour** — `TCI_ERP/src/design/palette.ts`: OKLCH ramps of ten steps,
  every step of every hue at the same WCAG luminance, so the pairing rule
  (text 5 steps apart, icons / large text 4) holds by construction. Ramps:
  warm neutral (`slate`), navy brand (`accent`), sky secondary (`sky`),
  success / warning / danger / info, data hues (violet, teal, magenta); the
  grade scale A1 → D (tint / solid / ink); categorical and sequential data
  palettes. `npm run design:tokens` writes `src/design/tokens.css` (the
  Tailwind `@theme`; Tailwind's own palettes switched off).
* **Typography** — seven sizes (`text-caption` … `text-display`), three
  weights; the display face only for page titles and key figures; section
  titles in the body face. Every arbitrary size and Tailwind size name in the
  code migrated to the scale.
* **Spacing / radius / elevation** — 4 px grid (half steps migrated up),
  lighter shadows, softer borders; table heads light (navy is the sidebar's);
  the sidebar one step dimmer.
* **Motion** — productive 70 / 110 / 150 ms, expressive 240 / 400 ms, Carbon
  easings; `prefers-reduced-motion` turns motion off globally.
* **Token page** — `/admin/tokens` (admin only).
* **Guards** — `src/design/contrast.test.ts` (palette rule + every colour class
  in use against its surface), `src/design/scale.test.ts` (closed type /
  weight / spacing / colour scales), `src/design/tokens.test.ts` (generated CSS
  in sync).
* **Colour audit** — `docs/colour-audit-2026-10.md`; decorative colour
  returned to neutral; the orange call-to-action replaced by sky (orange failed
  contrast).

Decisions taken on the owner's behalf (reversible):

1. The Tailwind class names `slate` and `accent` are kept for the new neutral
   and navy ramps, so 1 000+ classes re-colour without a rename. Reverse:
   rename in `RAMP_SPECS` and migrate the classes.
2. Orange is retired as a brand colour; the single call-to-action is sky 600.
   Reverse: point `Button variant="accent"` back at an orange ramp (it needs
   dark text to pass contrast).
3. `slate-400` is no longer a text colour (3.4 : 1); 152 places moved to
   `slate-500`. Icons may still use it.
4. Section titles lose the blue square and the condensed caps.

## Phase 2 — Components — done

* **Table v2** (`components/ui/primitives.tsx` Table, `tablePrefs.ts`,
  `TableSettings.tsx`): per-person row density (compact / regular / relaxed;
  staff regular, portal relaxed), `stickyHead`, `freezeFirst`, a remembered
  column chooser per registry (`id`), hover-revealed row actions, search
  highlight (`Highlight`), skeleton rows at the density's height
  (`SkeletonRows`), the bulk bar (`BulkBar`, first used by the companies
  registry: select rows → CSV export, `csv.ts` with formula-injection
  guard), and the quick view in a non-modal `SidePanel`. Wired into the
  companies registry and the limits queue; rolled out afterwards to every
  staff registry and queue (limits in force, policies, submissions, claims,
  declarations, overdue notifications, data requests), with quick view on
  the limits queue, policies, claims and declarations and the bulk bar on
  policies and claims. Pages keep their own search and filter inputs (to be
  replaced by the top-bar search in one sweep); `Highlight` is fed from the
  page's search value.
* **KpiCard** (`kpi.ts`): the figure as hero, change against a stated
  baseline coloured by meaning, sparkline; `runningCountByMonth` gives a
  register an honest baseline.
* **Badges**: one tone rule (100 tint / 700 ink / 200 hairline);
  `GradeBadge` in the grade scale's own colours replaces `gradeTone` on 17
  screens.
* **HumanAmount**, **EmptyState pictograms** (nine own line drawings),
  **useFlash + Button done** (inline success), **command palette** over
  companies, policies, claims, submissions and actions, recent first, only
  in the acting role's sections (`paletteSources`), **forms** (labels above
  in sentence case, `FormSection`, blur validation `useTouched` /
  `checkRequired` / `checkEmail` / `checkUrl`, outcome-named buttons, dialog
  body scrolls under a fixed head and footer).
* Guards: `contrast.test.ts` caught one icon colour in KpiCard (fixed);
  `layoutContract.test.ts` caught a doc comment quoting `<Table>` (fixed).

## Phase 3 — Signature screens — done («bold fintech», owner's choice)

The owner looked at phase 1 and found it too quiet («almost the same,
boring»); offered three directions, they chose **bold fintech**.

* `HeroBand` (navy band, trade mosaic, inverse KPI tiles with colour
  ribbons) on the dashboard (+ «The book by grade» chart), the Agenda
  (overdue / today / mine / done), the company card (grade, limits in force,
  latest statements), the credit decision page (requested, buyer grade,
  waiting) and the portal home (policies in force, buyer limits, next
  renewal — edge to edge). Registries and queues (companies, submissions,
  claims, and the policies / credit limits / data sections) open with the
  compact band; a primary button on the band turns white (`onBand`).
* Sign-in: full-height navy panel with the mosaic (`LOGIN_PHOTO` slot for a
  licensed photograph).
* The printed risk report's running header is the band, compact.
* Tone of voice: DESIGN.md «Tone of voice», five rules and ten strings in
  en / ru / uz.

## Phase 4 — Structure (owner, 2026-10-26: «free to change layout, forms, structure»)

Re-read the brief against the screens; what it asks beyond colour:

* **Credit decision page** — one decision column (the work first: the
  decision, the validation step or what is missing; the request, the buyer
  and what changed beside it as context); requested → recommended → in
  force → this decision as bars on one scale (`DecisionBar`); the decider's
  authority and the group limit as meters (`Meter`, `meterState`).
* **One search** (owner request) — the top-bar field is a real input, no
  popup on click. On a list page it filters the page (`usePageSearch`,
  `lib/pageSearch.ts`): comma-separated terms applied in order, a term equal
  to a value matching exactly, otherwise «contains»; no country is needed
  (one more term when a name exists twice). System-wide matches of the term
  being typed show under the field — folded to one line on a filtered page.
  The page search boxes and the country / industry / status / policyholder /
  structure / band / currency pickers are gone from companies, policies,
  contracts, submissions, the credit queue, limits in force, declarations;
  claims, overdues and the data queue are searchable for the first time.
  View switches (tabs, «All / Policyholders / Buyers», «Open / All», «only
  what I can decide alone») stay.
* **Company card** — nine tabs grouped into six sections (`cardTabs.ts`;
  `?tab=` deep links unchanged); «Open work» in the band (limit requests,
  submissions, claims, each a way to its tab); «Quick facts» side panel.
* **Agenda** — the buyer's grade on every buyer row; group sums in human
  scale with the full figure on hover; «All caught up» (the one expressive
  entrance, 400 ms, none under reduced motion) when the day's work is done.
* **Dashboard** — the book by grade as buyers OR exposure (UZS, limits in
  force; unrated exposure said apart).
* **Portal** — «In progress» with simple status timelines for limit
  requests, submissions and claims, «waiting for you» first
  (`StatusTimeline`, `timelines.ts`); the overdue form says when no buyer
  has a limit in force and stays inactive.
* **Financial sheets** (owner request) — «Show empty lines» in the
  sheet-tab row (the same gap on every sheet); the tab row and the column
  headings stick under the top bar (`StickyTableFrame`; a table wider than
  its frame scrolls sideways instead).
* **Table v2 everywhere** — limits queue, limits in force, policies,
  submissions, claims, declarations, overdues, data queue (density, column
  chooser, sticky head, frozen first column, skeletons, quick view on the
  queue / policies / claims / declarations, bulk CSV on policies and claims).
* **Migration 0080** (a defect the owner found): the portal no longer lists a
  staff DRAFT limit request — it had no action and no explanation.

## Decisions taken on the owner's behalf (all reversible)

1. Tailwind names `slate` / `accent` kept for the new ramps — reverse by
   renaming in `RAMP_SPECS`.
2. Orange retired as a brand colour; the call to action is sky 600 —
   reverse in `buttonStyles.ts` (`accent`).
3. `slate-400` no longer a text colour — the contrast guard enforces it.
4. Section titles lose the blue square and condensed caps.
5. Form labels in sentence case above the field (was uppercase) — reverse
   in `Field`.
6. Table density default regular (staff) / relaxed (portal) — `AppShell` /
   `PortalShell` provider values.
7. Quick view opens from a hover «eye» button; a row click still opens the
   full page (no extra click on the main path).
8. Bold fintech hero bands (owner-chosen); the band's light text limited to
   white / accent 100 / sky 200.
9. The commercial-offer cover is NOT changed: its words and pages are the
   approved brochure, pinned by SHA-256 (`kp/templates/tci.test.ts`), and it
   already uses the trade mosaic covers. Changing it needs the owner's
   approval of a new brochure version.
10. Agenda bulk selection not added (its row grid is guarded by the layout
    tests); the bulk bar's first use is the companies registry.
11. The Agenda band is the compact one, its four figures inline with the
    title, and the triage panes' minimum height drops 448 → 352 px
    (`useFillViewport`) — at 1280×720 a full band pushed the panes past the
    viewport (the card-rows guard caught it). Reverse: drop `compact` /
    `stats` on the Agenda's `HeroBand` and restore 448 together, then re-run
    `e2e/layout/cardRows.spec.ts`.
12. Table v2 rollout: to fit 1280 px with the selection box and the quick
    view, the policies register shows its period on two lines (from / to)
    and the claims queue shows the indemnity under the claimed amount (one
    column, «Заявлено / Возмещение»); the credit queue, limits in force and
    the data queue left the `dense` variant so the person's row density
    applies. Reverse: drop the bulk / quick-view columns of those tables and
    restore the previous widths (`git log -p` on the pages).
13. One search replaces every page search box and filter picker (owner
    request). Reverse per page: restore the removed `<Input>` / `<Select>` /
    `<Combobox>` and the local state from `git log -p`; `usePageSearch`
    can stay (it only reads `?q=`).
14. Company card sections: Overview · Analysis (financials, rating) · Cover
    (limits, policies, submissions) · Claims · Group · Client access.
    Reverse: render `availableTabs` directly in `<Tabs>` again
    (EntityDetailPage) and delete `cardTabs.ts`.
15. Decision page: the decision column first, the request and buyer as the
    side column. Reverse: swap the two columns back in `LimitRequestPage`.
16. Text size apart from zoom (owner, 2026-10-27): five steps 100–150 %,
    default 100 % (no change for anyone who does not pick one); the
    columns, the sidebar, the Agenda's tag / due tracks and the hero tiles'
    least width grow with the text, other boxes keep the zoom's geometry.
    The paper documents (risk report on the Overview tab, contract, offer)
    keep their own sizes. Reverse: `textSized` in `palette.ts` → plain
    sizes, regenerate tokens; the picker in `UiScalePicker.tsx`.
17. «In force» → «Active» in English (owner request): «Active limits»,
    «Active policies», «No active limit» … The approved brochure keeps its
    wording (pinned), and ru «действующие» / uz «amaldagi» are unchanged
    pending the owner. Reverse: `git log -p` on `en.json`.
18. «Кредитные лимиты» and «Полисы» carry their book's figures on the band
    on every view (the overview's white strip removed), for the desks that
    have the overview; the policy overview's «Active / All» switch now
    governs its tables only — the band always shows the active book.
    Reverse: drop `figures` on `SectionPage` in `LimitsSection` /
    `PoliciesSection` and restore the `KeyFigures` strips from `git log -p`.
19. Company card: the sections stick with a slim navy name bar
    (`CardStickyBar`); the period / currency controls do NOT stick (they
    would take a third row of the screen). Reverse: render `<Tabs>` in
    place of `<CardStickyBar>` in `EntityDetailPage`.

## Latency (phase 3, production bundle, median of 5)

Measured in the page from the click to the frame in which the result is on
screen (`vite preview` of a stub build, network sealed, 1440×900):

| action | median |
|---|---|
| ⌘K command palette opens | 9 ms |
| Companies: quick view side panel | 18 ms |
| Companies: table settings popover | 10 ms |
| Agenda: List → Triage | 23 ms |
| Credit limits: switch view tab | 40 ms |
