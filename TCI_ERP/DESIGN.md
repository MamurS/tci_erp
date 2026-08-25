# TCI ERP Design System

Light theme, clean professional fintech aesthetic (Linear / Stripe-dashboard
reference). Implemented with Tailwind CSS v4; tokens live in `src/index.css`
under `@theme` and are the single source of truth.

## Tokens

### Color

| Role | Token / Tailwind class | Value |
|---|---|---|
| Page background | `bg-slate-50` | `#f8fafc` |
| Surface (cards, tables) | `bg-white` | `#ffffff` |
| Border | `border-slate-200` | `#e2e8f0` |
| Text primary | `text-slate-900` | `#0f172a` |
| Text secondary | `text-slate-500` | `#64748b` |
| Accent (actions, active nav, focus) | `accent-600` | `#4f46e5` (indigo) |
| Accent hover | `accent-700` | `#4338ca` |
| Positive dynamics | `pos-500` | `#16a34a` |
| Negative dynamics / errors / negative numbers | `neg-500` | `#dc2626` |
| Validation warnings (non-blocking) | `warn-500` / `warn-50` | amber |

One accent only. Green/red are reserved for *meaning* (dynamics, validation),
never decoration.

### Typography

Font stack: Inter → system UI. Scale: page title `text-xl font-semibold`,
section title `text-sm font-semibold`, body `text-[14px]`, table/dense
`text-[13px]`, caption `text-xs text-slate-500`.

### Spacing & radii

Tailwind default 4px spacing scale. Page padding `p-6`; card padding `p-5`;
dense table cells `px-3 py-1.5`. Radii: controls `rounded-md` (8px), cards
and modals `rounded-lg` (12px).

## Core components (`src/components/ui`)

Button (primary / secondary / ghost / danger, sizes md·sm), Input, Select,
Segmented (mutually-exclusive switch), Card, Table (dense financial
variant), Tabs, Badge (sizes md·lg; grade tone map in src/lib/grade.ts),
Modal, EmptyState, PageHeader. Screens compose these — no ad-hoc one-off
controls.

## Financial data display rules (apply everywhere)

* Numbers **right-aligned** with `tabular-nums` — use the `num` utility class.
* Thousands separator: space; decimal comma for ru/uz, standard `1,234.56`
  for en (`src/lib/format.ts` is the only formatter — never `toLocaleString`
  inline).
* Negative values: red (`text-neg-500`) with a minus sign.
* Percentages: 1 decimal place.
* Dynamics: ▲/▼ indicator; **green means improvement, red means
  deterioration** — direction-aware: for expense, liability and debt lines an
  increase is deterioration (red ▲). Line directions are declared in
  `src/features/buyers/financials/lines.ts`.
* Null / absent values render as "—", never as 0.
* Subtotal rows: `font-medium bg-slate-50`; grand totals: `font-semibold`
  with a top border.

## Validation style

Non-blocking accounting-equation warnings are amber (`warn-*`), never red;
red is reserved for hard errors. Warnings do not prevent saving — the
analyst's entered figure is the source of truth.
