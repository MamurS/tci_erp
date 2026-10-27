/**
 * The badge spec (DESIGN.md «Badges»), kept apart from the components so a
 * chip that is a button or a list item can wear it too (like buttonStyles).
 *
 * Grade, role, status, type tags, counters and chips are ONE object in two
 * sizes — `sm` in tables, rows and running text, `md` beside a page title.
 * Body font (never the condensed display face, whatever the parent sets),
 * sentence case as translated (never capitals, inherited or not), a pill
 * radius, one weight per size, a fixed height with the text centred in it.
 * Only the tone varies.
 */

import { createContext } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'negStrong' | 'warn'

export const BADGE_TONES: Record<BadgeTone, string> = {
  // One rule for every tone (Prompt 30): the ramp's 100 tint with its 700
  // ink and a 200 hairline — six steps apart, so text clears 4.5 : 1. With
  // white text (0089: `data-badge-ink` on <html>, light mode only —
  // src/lib/uiTheme.ts) the 700 becomes the fill, the same pair reversed.
  // The grey neutral tone is not a colour and keeps its tint. Literal class
  // names, so Tailwind generates them.
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  accent: 'bg-accent-100 text-accent-700 ring-accent-200 in-data-[badge-ink=white]:bg-accent-700 in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-accent-700',
  pos: 'bg-success-100 text-success-700 ring-success-200 in-data-[badge-ink=white]:bg-success-700 in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-success-700',
  neg: 'bg-danger-100 text-danger-700 ring-danger-200 in-data-[badge-ink=white]:bg-danger-700 in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-danger-700',
  // Solid danger for statuses that must not be mistaken for ordinary
  // termination (e.g. policy annulment vs cancellation).
  negStrong: 'bg-danger-600 text-white ring-danger-600',
  warn: 'bg-warning-100 text-warning-700 ring-warning-200 in-data-[badge-ink=white]:bg-warning-700 in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-warning-700',
}

export type BadgeSize = 'sm' | 'md'

const BADGE_BASE =
  'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full font-sans normal-case tracking-normal whitespace-nowrap ring-1 ring-inset'

/** Height, padding, text size and weight per size. */
export const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: 'h-text-5 px-2 text-caption leading-text-4 font-medium', // 20 px tall, 12 px text (× the text size)
  md: 'h-text-6 px-3 text-small leading-text-5 font-semibold', // 24 px tall, 13 px text (× the text size)
}

/** The look of a badge, for an element that is not a <Badge> (a button chip,
 * a list item, the Agenda's type tag); pair it with `data-badge={size}`. */
export function badgeClassName(size: BadgeSize = 'sm', tone: string = BADGE_TONES.neutral): string {
  return `${BADGE_BASE} ${BADGE_SIZES[size]} ${tone}`
}

/** A page header's status slot makes the badges inside it `md`. */
export const BadgeSizeContext = createContext<BadgeSize>('sm')
