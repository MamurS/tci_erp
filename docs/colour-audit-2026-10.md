# Colour audit — October 2026 (Prompt 30, phase 1)

Every saturated colour the screens use, by area, with what it means. The rule
(docs/design-research-2026-10.md, «Colour means something»): a saturated
colour is a signal — status, risk, money direction, the primary action, a
category. Decoration uses neutrals.

Generated from the class lists in `TCI_ERP/src` (tests, the design module and
the fixed offer template excluded) after phase 1. Families are the token
names: `pos` / `neg` / `warn` are the earlier names of `success` / `danger` /
`warning`, kept as aliases of the new ramps.

## What each family means

| Family | Uses | Meaning |
|---|---|---|
| `accent` | 324 | brand navy — primary actions, selection, links in text, page titles, key figures |
| `neg` | 185 | danger — errors, negative values, overdue, declined, revoked |
| `warn` | 148 | warning — attention, due soon, non-blocking warnings |
| `pos` | 45 | success — positive dynamics, paid, approved |
| `sky` | 14 | secondary brand — focus rings, the one call-to-action, highlights, informational icons |
| `success` | 1 | success — positive dynamics, paid, approved |

## By area

| Screen / area (folder) | Saturated colour families (uses) |
|---|---|
| `auth` | warn ×5, accent ×5 |
| `components/layout` | accent ×14, sky ×3, warn ×1, neg ×1 |
| `components/ui` | accent ×57, neg ×23, warn ×9, pos ×9, sky ×2 |
| `features/account` | neg ×8, warn ×7, pos ×4, accent ×2 |
| `features/admin` | warn ×14, neg ×13, accent ×11, pos ×7, success ×1, sky ×1 |
| `features/agenda` | accent ×17, neg ×13, warn ×5, pos ×1 |
| `features/agenda/triage` | accent ×17, neg ×5, warn ×4, pos ×3 |
| `features/claims` | accent ×11, neg ×5, warn ×2, pos ×1 |
| `features/contracts` | neg ×6, accent ×5, sky ×2, pos ×1 |
| `features/contracts/editor` | accent ×4 |
| `features/data` | accent ×9, warn ×1 |
| `features/declarations` | accent ×2, warn ×1 |
| `features/entities` | accent ×4, neg ×4, warn ×3, sky ×1 |
| `features/entities/financials` | warn ×21, neg ×16, accent ×12, pos ×4 |
| `features/entities/overview` | accent ×3 |
| `features/entities/rating` | neg ×10, pos ×6, accent ×5, warn ×2 |
| `features/entities/report` | accent ×2, sky ×2 |
| `features/groups` | warn ×14, accent ×12, neg ×11, pos ×1 |
| `features/limits` | warn ×29, accent ×22, neg ×18, pos ×3 |
| `features/limits/workbench` | accent ×14, neg ×3, warn ×2 |
| `features/offers` | accent ×13, sky ×2 |
| `features/overdue` | accent ×3 |
| `features/policies` | neg ×8, accent ×6, warn ×1 |
| `features/policies/payments` | accent ×5, warn ×2 |
| `features/portal` | accent ×13, neg ×5, warn ×2, pos ×1 |
| `features/portfolio` | accent ×9, warn ×4, neg ×2, pos ×1 |
| `features/requests` | neg ×8, warn ×7, accent ×5, pos ×1 |
| `features/wording` | neg ×15, accent ×15, warn ×5, pos ×1 |
| `lib` | accent ×1 |
| `pages` | accent ×26, neg ×11, warn ×7, pos ×1, sky ×1 |

## Returned to neutral in phase 1 (colour without a meaning)

| Where | Was | Now | Why |
|---|---|---|---|
| Section titles (`SectionTitle`, dashboard panels) | navy uppercase display face + a blue square | body face, semibold, neutral 900, no marker | decoration; the display face is for page titles and key figures only |
| Top bar section name | navy uppercase display face, blue icon | neutral 700 body face, neutral icon | chrome recedes |
| KPI tile icons (`StatCard`, dashboard) | blue | neutral 500 | decoration |
| Empty-state icon disc | blue tint | neutral 100 / 500 | decoration (phase 2 pictograms) |
| Avatars (Agenda list and triage) | blue tint | neutral 100 / 700 | identity, not a signal |
| Template file icon | blue | neutral 500 | decoration |
| Table heads (`Table dense`) | navy band, white caps, zebra rows | light head (neutral 50 / 600), no zebra | navy is the sidebar's |
| The one call-to-action (`Button variant="accent"`, print toolbars) | orange, white text 3.4 : 1 | sky 600, white text ≥ 4.5 : 1 | orange failed contrast and was a third brand colour |
| Overdue/escalation count in the sidebar | brand amber | warning 300 | it is a warning |
| Grey secondary text `slate-400` (152 places) | 3.4 : 1 on white | `slate-500` (≥ 4.5 : 1) | below the text contrast minimum |

The remaining orange (`brand-orange`) lives only in the printed risk report's
own stylesheet and is replaced with the grade scale and chart palette in
phase 3.
