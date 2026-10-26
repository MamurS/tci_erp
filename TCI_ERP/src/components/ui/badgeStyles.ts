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
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
  pos: 'bg-pos-50 text-pos-500 ring-pos-500/20',
  neg: 'bg-neg-50 text-neg-500 ring-neg-500/20',
  // Solid danger for statuses that must not be mistaken for ordinary
  // termination (e.g. policy annulment vs cancellation).
  negStrong: 'bg-neg-500 text-white ring-neg-500',
  warn: 'bg-warn-50 text-warn-500 ring-warn-500/25',
}

export type BadgeSize = 'sm' | 'md'

const BADGE_BASE =
  'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full font-sans normal-case tracking-normal whitespace-nowrap ring-1 ring-inset'

/** Height, padding, text size and weight per size. */
export const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: 'h-5 px-2 text-caption leading-4 font-medium', // 20 px tall, 12 px text
  md: 'h-6 px-3 text-small leading-5 font-semibold', // 24 px tall, 13 px text
}

/** The look of a badge, for an element that is not a <Badge> (a button chip,
 * a list item, the Agenda's type tag); pair it with `data-badge={size}`. */
export function badgeClassName(size: BadgeSize = 'sm', tone: string = BADGE_TONES.neutral): string {
  return `${BADGE_BASE} ${BADGE_SIZES[size]} ${tone}`
}

/** A page header's status slot makes the badges inside it `md`. */
export const BadgeSizeContext = createContext<BadgeSize>('sm')
