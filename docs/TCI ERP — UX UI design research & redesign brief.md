# TCI ERP — UX/UI design research & redesign brief

Oct 26, 2026 · @Mamur Sadikov

## Summary

TCI ERP feels dull not because it lacks colour but because nothing on screen is clearly more important than anything else: navy headers on every table, equal-weight KPI tiles, flat badges, plain empty states. The best enterprise products are calm by default and vibrant exactly where meaning lives.

The ten moves with the biggest effect:

1. **Rebuild colour in a perceptual space (OKLCH)** — vibrant ramps that still pass contrast, with a simple pairing rule.
2. **Make the grade scale the signature colour** across badges, bars, charts and the Agenda.
3. **Quiet the chrome** — dim the sidebar, lighten table headers, fewer borders and icons, so the work area leads.
4. **Warmer neutrals** instead of cold blue-grey.
5. **Numbers as heroes** — display face for KPIs, tabular figures everywhere, human-scale amounts with full values on hover.
6. **Table v2** — density switch, sticky header, frozen column, hover actions, quick-view side panel.
7. **KPI cards with context** — change vs baseline and a sparkline, “what needs me today” first.
8. **Instant feel** — feedback under 100 ms, productive motion of 70–150 ms, inline success confirmations, skeletons.
9. **Personality at the edges** — branded login, pictogram empty states, restrained completion moments, a richer client portal and offers.
10. **Guardrails in CI** — contrast, target size, focus, layout stability and three-language checks so the new look stays consistent.

Recommended order: foundations (tokens) → components → signature screens; details in the brief at the end.

## Benchmarks: what the best products do

The products people call beautiful are not the most colourful ones; they are the most disciplined ones, with colour spent only where it carries meaning.

| Product | What they do | What to borrow for TCI ERP |
| --- | --- | --- |
| [Linear](https://linear.app/now/behind-the-latest-design-refresh) (refresh, March 2026) | Keeps a dense interface calm by dimming navigation so the work area dominates, cutting icon count and size, and softening borders: “don’t compete for attention you haven’t earned”, “structure should be felt not seen”. Moved its greys from cool blue toward a warmer, crisp grey. | Dim the navy sidebar one step; fewer, smaller icons; lighter separators; a slightly warmer neutral background instead of cold blue-grey. |
| [Stripe](https://stripe.com/blog/accessible-color-systems) | Built a palette in a perceptually uniform colour space so every hue has equal visual weight at each step, stays vibrant, and passes contrast. Any two steps five levels apart are safe for small text; badges use a tinted background with text one step stronger. | Rebuild our colour ramps the same way (OKLCH): vibrant status colours that still pass WCAG, with a simple pairing rule instead of case-by-case checks. |
| [Mercury](https://www.instrument.com/work/mercury) | Rejects the “cold, transactional feel” of banking in favour of warmth, care and intention, through refined typography, art-directed photography and strict grids. | Warmth comes from typography, imagery and tone, not from more colour on data screens. Use it on the portal, empty states, login and offers. |
| [IBM Carbon](https://carbondesignsystem.com/elements/motion/overview/) | Separates *productive* motion (fast, invisible, for task work) from *expressive* motion (occasional, for significant moments), with fixed duration tokens from 70 ms to 700 ms. | Adopt the two motion modes and the duration tokens; keep 95% of motion productive. |
| [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) (enterprise tables study) | Tables made pleasant by alignment discipline, light row dividers instead of zebra stripes, density options, sticky headers, hover-revealed actions and a quick-view side panel. | Our tables are the product; apply these rules everywhere (detail in Components). |

## Principles

Vibrant and calm are not opposites: the work surface stays quiet so that the few coloured things on it are instantly meaningful.

1. **Earned attention.** Only the user’s current task is bright; navigation, chrome and secondary text recede (Linear’s rule). A screen has one primary action.
2. **Colour means something.** Every saturated colour is a signal: status, risk, money direction, a category. Decoration uses neutrals, imagery and typography.
3. **Density with air.** Underwriters need many numbers on screen; density comes from tight, aligned rows, not from shrinking everything. Space between groups, not between lines.
4. **Structure felt, not seen.** Fewer borders and boxes; group with spacing and alignment. A card only when the content is a distinct object.
5. **Instant and stable.** Every click answers in under 100 ms; nothing on screen moves unless the user moved it.
6. **One system.** The same component looks and behaves the same on every screen and in all three languages. Consistency is what makes a dense tool feel easy.
7. **Personality at the edges.** Warmth and delight live in login, empty states, completions, the portal and offers, not in the middle of a coverage table.

## Colour: vibrant without noise

The system feels dull mostly because colour is either absent (grey-blue everywhere) or flat (red for anything urgent). The fix is a richer but strictly rule-bound palette.

**Structure the palette in four layers.**

| Layer | Purpose | Proposal for TCI ERP |
| --- | --- | --- |
| Neutrals | Backgrounds, text, borders (\~90% of pixels) | Shift from cold blue-grey to a slightly warmer, crisp grey, as Linear did; white cards on a faint warm-grey canvas. |
| Brand | Identity, primary actions, selection | Keep the navy as the anchor; add the bright sky-blue from the “TCI” logo as a second brand colour for highlights, links and focus. |
| Semantic | Status and risk meaning only | Success, warning, danger, info as full 10-step ramps; never used decoratively. |
| Data | Charts, grade scale, categories | A categorical sequence and a sequential/diverging scale for grades and exposure (below). |

**Build ramps in a perceptual colour space (OKLCH).** HSL lies about lightness: yellow looks lighter than blue at the same value. Stripe rebuilt its palette so each hue has the same perceived lightness at each step, which kept colours vibrant while passing contrast. Their rule worth copying: any two steps five levels apart are safe for small text, four apart for icons and large text ([Stripe](https://stripe.com/blog/accessible-color-systems)).

**Badges and tags.** Tinted background (step 1–2) with text two to three steps darker in the same hue, never saturated fills with white text for routine statuses. Solid fills are reserved for the one or two states that must shout (e.g. annulled, blocked).

**The grade scale is your signature colour moment.** Ratings are the most-viewed signal in the product. Give grades A→D a dedicated diverging scale (e.g. teal/green → amber → red) used consistently on the grade badge, the GradeScale bar, charts and the Agenda. This alone makes screens livelier and more informative.

**Charts.** Use a curated categorical order that maximises contrast between neighbours, and monochrome sequential scales for magnitude; avoid multiple gradients ([Carbon data-viz palettes](https://www.carbondesignsystem.com/building-blocks/data-visualization/color-palettes)). Carbon’s alert set (red, orange, yellow, green) maps cleanly to our overdue/urgent/attention/ok states.

**Accent budget.** At most one saturated accent area per viewport besides status signals: the primary button, the selected row, or a highlighted KPI — not all three.

**Dark mode** is optional for an underwriting tool; if added later, build it from the same OKLCH ramps rather than inverting colours.

## Typography, spacing, density and numbers

Typography does most of the work of making a dense screen feel premium; it costs nothing in colour or noise.

- **Two families, clear jobs.** Keep the condensed display face for page titles and big KPI numbers only (it is the product’s voice); everything else in one text family (Inter or equivalent). Both must cover Cyrillic and Uzbek Latin characters (oʻ, gʻ) properly — test them.
- **A short type scale.** Roughly 12 / 13 / 14 / 16 / 20 / 28 / 36 px with three weights (regular, medium, semibold). Hierarchy through size and weight, not colour.
- **Numbers are first-class.** Tabular figures everywhere money or counts appear, right-aligned, consistent decimals per column, so values line up and compare at a glance ([Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)). Big KPI numbers in the display face; units smaller and lighter beside them (“203.2 млн UZS”).
- **Human-scale amounts.** Show 3,184,000,000 as 3.18 bn in summaries, full figures in tables and on hover. Never mix both styles in one column.
- **Spacing on a 4 px grid** with a few allowed steps (4, 8, 12, 16, 24, 32, 48). Larger gaps between groups, smaller inside them; this replaces most borders.
- **Density options for tables.** Compact \~40 px, regular \~48 px, relaxed \~56 px row heights, user-selectable and remembered ([Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)). Default regular for staff screens, relaxed for the client portal.
- **Line length** for prose (notes, narratives, offers) 60–80 characters; long text never stretches across a 1,900 px screen.

## Components

Most of the product is tables, KPI cards, forms and status badges; getting these five right changes how the whole system feels.

**Tables** ([Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)):

- Text left-aligned, numbers right-aligned in tabular figures, headers aligned with their column; never centre-align.
- Light 1 px row dividers instead of zebra stripes, which clash with hover, selected and disabled states; vertical separators optional.
- Sticky header, frozen first column when scrolling sideways, density switch, column show/hide with “reset to default”, settings remembered per user.
- Row actions revealed on hover or focus; bulk actions appear only after rows are selected, in a bar.
- Row detail in a quick-view side panel rather than a full page jump when users scan many records (limits queue, registry, claims).
- Search matches highlighted in rows.

**Dashboards and KPI cards.** One row of 4–6 KPIs, each with value, unit, change versus a stated baseline (▲ 4.2% vs last month) and a tiny sparkline; the number is the hero, the label is small. Below, at most two charts and one action list. A dashboard answers “what needs me today” before “how are we doing”.

**Badges, tags, chips.** One component, two sizes, tinted background with darker text in the same hue (see Colour), consistent case, fixed heights. Status vocabulary per object documented in one table.

**Forms.** Labels above fields; related fields grouped with headings; inline validation on blur, not on every keystroke; required marked once and clearly; the primary button names the outcome (“Submit request”, not “OK”); long forms get a sticky footer with the actions and a progress hint.

**Empty states** replace the missing element (not a header over nothing), say what will appear and offer one next action, phrased positively (“Start by adding a company” rather than “No companies”) ([Carbon empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)). For error empty states: plain language, no codes, a way out.

**Navigation and search.** A global command palette (⌘K) that opens any company, policy, claim or action by typing; recent items first. Breadcrumbs on deep pages. The sidebar stays dim so the work area leads.

**Side panels over modals** for anything users read while looking at a list; modals only for short confirmations and small forms.

## Motion, micro-interactions and perceived speed

Speed is the most noticed design quality: an interface that answers instantly feels good even if it is plain.

**Response-time budget** ([NN/g](https://nngroup.com/articles/response-times-3-important-limits)): under 0.1 s feels like direct manipulation; under 1 s keeps the user’s flow (show a busy cue beyond that); over 10 s loses attention and needs a percent-done indicator and a way to cancel. For TCI ERP: every click shows feedback within 100 ms through optimistic updates; navigation and table sorts under 1 s; PDF reports and imports show progress.

**Two motion modes** ([Carbon](https://carbondesignsystem.com/elements/motion/overview/)):

| Mode | Where | Duration tokens |
| --- | --- | --- |
| Productive (default, \~95%) | Hover, press, dropdowns, row expand, tab switch, table updates | 70–150 ms; micro-interactions 90–120 ms with ease-out |
| Expressive (rare) | Page entry, important alerts, completing a major step | 240–400 ms; background dim 700 ms |

Carbon’s test for good motion: if average users frequently notice it, remove or reduce it. Strictly linear movement looks unnatural; use ease-out for things entering and ease-in for things leaving.

**Micro-interactions that make the product feel alive without noise:**

- Button press and toggle states that respond on pointer-down.
- Numbers that change (a KPI after a decision, a counter in the sidebar) update with a brief highlight on the changed value, not a full re-render.
- Saved / sent / approved confirmation as a small check transforming in place of the button for \~1 s, instead of a toast that covers content.
- Skeleton rows matching the real row height while loading, never spinners in the middle of empty tables.
- Instant panels (the sidebar peek is the model): appearance itself can be instant; motion is optional.

**Reduced motion.** Respect the operating-system setting: all non-essential animation off, same information delivered statically.

## Personality and delight in a B2B insurance tool

An insurer’s tool should feel trustworthy first; personality comes from care in the details, not from jokes or decoration. Mercury’s brand work is the model: it replaced the “cold, transactional feel” of banking with warmth, care and intention through typography, art-directed photography and structured grids ([Instrument / Mercury](https://www.instrument.com/work/mercury)).

**Where personality belongs**

| Surface | What to do |
| --- | --- |
| Login and first screen of the day | A calm branded panel (photography of trade, logistics, Tashkent business life) beside the form; a greeting with today’s date and the one number that matters (“3 decisions waiting”). |
| Empty states | Small, consistent line illustrations or pictograms in the brand colours; positive, specific copy with one action. |
| Completion moments | A brief, restrained celebration when meaningful work is done: Agenda cleared (“All caught up”), a policy bound, a claim paid. A check animation and a warm line, no confetti on routine saves. |
| Client portal and commercial offers | Richest visual expression: hero imagery, generous whitespace, larger type; this is what policyholders see of MIG. |
| Print reports and offers | Branded cover, clear typographic hierarchy, the grade scale as the signature graphic. |

**Where it does not belong:** inside data tables, decision forms, error messages. Carbon’s guidance for error states is explicit: be respectful, don’t joke or use flippant language ([Carbon](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)).

**Voice in three languages.** Short, direct, active, the same register in en / ru / uz; address the user politely and name the outcome (“Limit approved for Navoi Textile”). A tone guide with 10 example strings per language keeps future screens consistent.

**Imagery rules.** Licensed or own photography only, real local context over generic stock, one consistent treatment (colour grade, crop), never on data screens.

## Accessibility and quality guardrails

A vibrant redesign is only an improvement if it stays readable, operable and stable; these guardrails go into CI, not into good intentions.

| Guardrail | Rule | Source |
| --- | --- | --- |
| Text contrast | 4.5:1 for normal text, 3:1 for large text and icons; built into the OKLCH ramps so it holds by construction | [Stripe](https://stripe.com/blog/accessible-color-systems), WCAG |
| Target size | Click targets at least 24 × 24 CSS px or spaced enough apart (WCAG 2.2, 2.5.8 AA); icon buttons in tables included | [W3C WCAG 2.2](https://w3.org/WAI/standards-guidelines/wcag/new-in-22/) |
| Focus not obscured | A focused element is never fully hidden by sticky headers, footers or panels (2.4.11 AA) | [W3C WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/?facet2=pdf) |
| Focus visible | Keyboard focus ring in the brand blue, shown on keyboard focus only | Existing project rule |
| Colour not alone | Status always has a word or icon as well as a colour (▲/▼, label) | WCAG 1.4.1 |
| Reduced motion | Honour the OS setting; nothing essential conveyed only by animation | [Carbon](https://carbondesignsystem.com/elements/motion/overview/) |
| Layout stability | No element moves when another changes (already enforced by the layout guard) | Project rule (Prompt 23) |
| Language length | Every component tested in en, ru and uz; Russian and Uzbek labels are often noticeably longer than English, so widths are reserved for the longest | Project rule |
| Performance | Interaction feedback < 100 ms; route change < 1 s | [NN/g](https://nngroup.com/articles/response-times-3-important-limits) |

## Application to TCI ERP: screen by screen

The biggest visible gains come from five screens; everything else inherits the new tokens and components.

| Screen | Today (from recent screenshots) | Change | Priority |
| --- | --- | --- | --- |
| Dashboard | Greeting, role list, five flat KPI tiles of equal weight, long warning banner on top | KPI row with change vs last month and sparklines; “waiting on you” list first; security banner compact and dismissible; grade-mix and exposure charts in the new data palette | High |
| Agenda | Redesigned, but rows still heavy with tag + title + long context | Tighter rows, grade colours on buyer chips, amounts in human scale with full value on hover, completion moment when the queue is cleared | High |
| Company card | Many tabs, flat header, mismatched badges | Header as a summary card: grade badge in the signature scale, exposure, open items; tabs reduced or grouped; side panel for quick facts | High |
| Registries and queues (companies, limits, policies, claims) | Navy header bars on every table, uniform weight | Lighter table header (navy only for the sidebar), density switch, frozen first column, quick-view side panel, hover actions | High |
| Credit limit decision | Many boxes of equal weight | One decision column with the authority/group preflight as a clear meter; requested → decided as a visual bar | Medium |
| Login | Plain form | Branded split screen with photography and the product name; same in portal | Medium |
| Client portal | Same density as staff app | Relaxed density, larger type, imagery, simple status timelines for requests and claims | Medium |
| Print risk report and offers | Functional | Branded cover, grade scale as hero graphic, consistent chart palette | Medium |
| Empty states everywhere | Grey icon + text | Pictogram set in brand colours, positive copy, one action | Low (but visible) |

## Brief for the redesign prompt

The redesign should ship in three phases so each one is reviewable and nothing breaks at once; this section is the material to turn into Claude Code prompts.

**Phase 1 — Foundations (tokens, no screen changes beyond what tokens cause)**

1. Rebuild colour as OKLCH ramps: warm neutrals, navy brand, sky-blue secondary, four semantic ramps, grade scale A→D, categorical and sequential data palettes. Document the pairing rule (steps 5 apart for text, 4 for icons).
2. Type scale and weights, tabular numbers utility, display face for titles and KPI numbers only.
3. Spacing scale on 4 px; radius and elevation tokens (fewer shadows, softer borders).
4. Motion tokens: productive 70/110/150 ms, expressive 240/400 ms, easings; reduced-motion handling.
5. Update DESIGN.md with all of the above and a visual token page in the app (admin-only) showing every token, like Linear’s internal colour tool.

**Phase 2 — Components**

1. Table v2: lighter header, row dividers, density switch, sticky header, frozen first column, hover actions, bulk bar, quick-view side panel, remembered settings.
2. KPI card with delta and sparkline; badge/tag/chip unified; grade badge and GradeScale in the new scale.
3. Empty-state component with pictogram slot and copy rules; skeleton rows; inline success confirmation.
4. Command palette (⌘K) over companies, policies, claims, requests and actions.
5. Dim sidebar one step; fewer and smaller icons.

**Phase 3 — Signature screens**

Dashboard, Agenda, company card header, credit decision page, login, client portal home, print report cover — per the table in the previous section.

**Acceptance criteria for every phase**

- All text and icon pairs pass contrast automatically (a test reads the token pairs).
- Layout guard, badge consistency and alignment tests stay green in en/ru/uz.
- Interaction feedback < 100 ms measured on five representative actions.
- Before/after screenshots of the same five screens in three languages.
- No colour used without a documented meaning; an audit lists every saturated colour usage by screen.
- The owner reviews a token preview page before Phase 2 starts.

## Sources

- [Linear — A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) (March 2026)
- [Stripe — Designing accessible color systems](https://stripe.com/blog/accessible-color-systems)
- [Instrument — Mercury, More than Banking](https://www.instrument.com/work/mercury)
- [IBM Carbon — Motion](https://carbondesignsystem.com/elements/motion/overview/)
- [IBM Carbon — Data visualization colour palettes](https://www.carbondesignsystem.com/building-blocks/data-visualization/color-palettes)
- [IBM Carbon — Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)
- [Pencil & Paper — Enterprise data tables UX patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
- [Nielsen Norman Group — Response times: the 3 important limits](https://nngroup.com/articles/response-times-3-important-limits)
- [W3C — What’s new in WCAG 2.2](https://w3.org/WAI/standards-guidelines/wcag/new-in-22/)
