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

## Phase 2 — Components — next

Table v2 (density, sticky head, frozen column, column chooser, hover actions,
bulk bar, search highlight, quick view), KPI card, unified badge with the grade
scale, human-scale amounts, empty states with pictograms, skeleton rows and
inline success, command palette, forms, side panels.

## Phase 3 — Signature screens — after phase 2
