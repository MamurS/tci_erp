/**
 * The building blocks of an OBJECT page (a claim, a declaration, an overdue
 * notification, a policy): one header that names the object, its status and
 * what can be done to it; one strip of key figures; facts as label → value
 * rows; and callouts for what needs attention. Composing every object page
 * from these is what keeps them looking like one application.
 */
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { BadgeSizeContext } from './badgeStyles'
import { Card } from './primitives'

// ---------------------------------------------------------------------------
// DetailHeader
// ---------------------------------------------------------------------------

interface DetailHeaderProps {
  /** What kind of object this is («Claim», «Declaration»), above the title. */
  eyebrow?: ReactNode
  title: ReactNode
  /** The status badge, set beside the title. */
  status?: ReactNode
  /** Context under the title (policy, policyholder, period), joined by a dot. */
  meta?: ReactNode[]
  /** Primary action first; destructive actions last, as `danger`/`ghost`. */
  actions?: ReactNode
}

export function DetailHeader({ eyebrow, title, status, meta, actions }: DetailHeaderProps) {
  const parts = (meta ?? []).filter((m) => m !== null && m !== undefined && m !== false && m !== '')
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[12px] font-semibold tracking-wider text-accent-500 uppercase">
            {eyebrow}
          </div>
        )}
        <div data-badge-row className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-display text-[28px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
            {title}
          </h1>
          {status && (
            // Header badges are `md` (DESIGN.md «Badges»).
            <BadgeSizeContext.Provider value="md">
              <span className="inline-flex flex-wrap items-center gap-2">{status}</span>
            </BadgeSizeContext.Provider>
          )}
        </div>
        {parts.length > 0 && (
          // A part that renders nothing (a chip with no group) leaves an empty
          // span: it is hidden, and the dot is drawn only between visible ones.
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 [&>span:empty]:hidden [&>span:not(:empty)~span:not(:empty)]:before:mr-2 [&>span:not(:empty)~span:not(:empty)]:before:text-slate-300 [&>span:not(:empty)~span:not(:empty)]:before:content-['·']">
            {parts.map((part, i) => (
              <span key={i} className="inline-flex items-center">
                {part}
              </span>
            ))}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </header>
  )
}

// ---------------------------------------------------------------------------
// KeyFigures — one card, cells divided by hairlines
// ---------------------------------------------------------------------------

export interface KeyFigure {
  label: ReactNode
  value: ReactNode
  /** One quiet line under the value: the basis, a comparison, a caveat. */
  meta?: ReactNode
  tone?: 'default' | 'pos' | 'warn' | 'neg' | 'muted'
  /** A word rather than a number (a cause, a status): set in the body face. */
  text?: boolean
}

const FIGURE_TONES: Record<NonNullable<KeyFigure['tone']>, string> = {
  default: 'text-accent-600',
  pos: 'text-pos-500',
  warn: 'text-warn-500',
  neg: 'text-neg-500',
  muted: 'text-slate-400',
}

const FIGURE_COLS: Record<number, string> = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
}

/**
 * The few numbers that matter, side by side in ONE card. The 1px gap over a
 * hairline background draws the dividers, so they stay right when the row
 * wraps on a narrow screen. Every cell is left-aligned the same way.
 */
export function KeyFigures({ items, className = 'mb-6' }: { items: KeyFigure[]; className?: string }) {
  return (
    <Card className={`overflow-hidden ${className}`}>
      <div className={`grid gap-px bg-slate-200/70 ${FIGURE_COLS[items.length] ?? 'sm:grid-cols-3'}`}>
        {items.map((item, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1 bg-white px-5 py-4">
            <span className="text-[12px] font-medium text-slate-500">{item.label}</span>
            <span
              className={`${
                item.text
                  ? 'pt-1 text-[15px] leading-snug font-semibold'
                  : 'font-display text-[24px] leading-tight font-bold tabular-nums'
              } ${FIGURE_TONES[item.tone ?? 'default']}`}
            >
              {item.value}
            </span>
            {item.meta && <span className="text-[12px] leading-snug text-slate-500">{item.meta}</span>}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DescriptionList — facts as label → value rows
// ---------------------------------------------------------------------------

export interface Fact {
  label: ReactNode
  value: ReactNode
  /** A short explanation under the label. */
  hint?: ReactNode
}

/**
 * Label on the left, value on the right, a hairline between rows. Numbers
 * use tabular figures so a column of amounts reads straight down. With
 * `columns={2}` a long list folds into two columns on a wide screen instead
 * of stretching each label away from its value.
 */
export function DescriptionList({ items, columns = 1 }: { items: Fact[]; columns?: 1 | 2 }) {
  return (
    <dl className={`grid text-[13px] ${columns === 2 ? 'gap-x-10 md:grid-cols-2' : ''}`}>
      {items.map((item, i) => (
        <div
          key={i}
          className={`flex items-baseline justify-between gap-6 border-b border-slate-100 py-2.5 first:pt-0 last:border-b-0 ${
            // In two columns the first row is two items: both start flush, so
            // the columns begin on one line.
            columns === 2 ? 'md:[&:nth-child(2)]:pt-0 md:[&:nth-last-child(2):nth-child(odd)]:border-b-0' : ''
          }`}
        >
          <dt className="min-w-0 text-slate-500">
            {item.label}
            {item.hint && <span className="mt-0.5 block text-[11.5px] text-slate-400">{item.hint}</span>}
          </dt>
          <dd className="text-right font-medium text-slate-900 tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Callout — what needs attention, said once, with what to do
// ---------------------------------------------------------------------------

type CalloutTone = 'info' | 'warn' | 'neg' | 'pos'

const CALLOUT_TONES: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'border-accent-200 bg-accent-50/70', icon: 'text-accent-500', Icon: Info },
  warn: { box: 'border-warn-500/30 bg-warn-50', icon: 'text-warn-500', Icon: AlertTriangle },
  neg: { box: 'border-neg-500/30 bg-neg-50', icon: 'text-neg-500', Icon: OctagonAlert },
  pos: { box: 'border-pos-500/25 bg-pos-50', icon: 'text-pos-500', Icon: CheckCircle2 },
}

interface CalloutProps {
  tone?: CalloutTone
  title: ReactNode
  children?: ReactNode
  /** A link or a button: what to do about it. */
  action?: ReactNode
  className?: string
}

/** Amber for what can wait, red for what blocks (DESIGN.md). */
export function Callout({ tone = 'info', title, children, action, className = '' }: CalloutProps) {
  const { box, icon, Icon } = CALLOUT_TONES[tone]
  return (
    <div
      role={tone === 'neg' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px] text-slate-700 ${box} ${className}`}
    >
      <Icon className={`mt-0.5 size-[18px] shrink-0 ${icon}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {children && <div className="mt-0.5 leading-relaxed">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
