/**
 * The pieces every triage body is built from: the three-figure strip, a
 * titled section, the loading skeleton and the chips. Text is never set in
 * the amber or the light green — both fall under 4.5:1 on white — so a
 * highlight is a tinted card or a coloured dot beside dark text.
 */

import type { ReactNode } from 'react'

import { Skeleton, badgeClassName } from '../../../components/ui'

export interface Figure {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  /** warn: a problem (amber tint); accent: what is new (light blue tint). */
  tone?: 'default' | 'warn' | 'accent'
}

const FIGURE_TONE: Record<NonNullable<Figure['tone']>, string> = {
  default: 'border-slate-200 bg-white',
  warn: 'border-warn-500/40 bg-warn-50 ring-1 ring-warn-500/20',
  accent: 'border-accent-200 bg-accent-50',
}

/** Three equal cards: the numbers that frame the task. */
export function FigureStrip({ figures }: { figures: Figure[] }) {
  return (
    <div className="mt-6 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
      {figures.map((figure, i) => (
        <div key={i} className={`flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3 ${FIGURE_TONE[figure.tone ?? 'default']}`}>
          <span className="text-small text-slate-600">{figure.label}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-title leading-tight font-semibold text-slate-900 tabular-nums">
            {figure.value}
          </span>
          {figure.sub && <span className="text-small leading-snug text-slate-700 tabular-nums">{figure.sub}</span>}
        </div>
      ))}
    </div>
  )
}

/** A dot that carries the colour of a sub line whose text stays dark. */
export function Dot({ tone }: { tone: 'pos' | 'neg' | 'warn' }) {
  const colour = tone === 'pos' ? 'bg-pos-500' : tone === 'neg' ? 'bg-neg-500' : 'bg-warn-500'
  return <span aria-hidden className={`mr-2 inline-block size-2 rounded-full align-middle ${colour}`} />
}

/** A status as the Agenda shows it: neutral text with a coloured dot. The
 * shared Badge tints its letters (amber, green, red), which fall under
 * 4.5:1 here. */
export function StatusBadge({ tone, children }: { tone?: string; children: ReactNode }) {
  const dot = tone === 'warn' || tone === 'pos' || tone === 'neg' || tone === 'negStrong' ? tone : null
  return (
    <span data-badge="sm" className={badgeClassName('sm', 'bg-slate-100 text-slate-700 ring-slate-200')}>
      {dot && <Dot tone={dot === 'negStrong' ? 'neg' : dot} />}
      {children}
    </span>
  )
}

/** A titled block of the body, divided from the previous one. */
export function Section({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-6 border-t border-slate-100 pt-5 ${className}`}>
      <h3 className="mb-3 text-caption font-semibold tracking-[0.08em] text-slate-600 uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** The heading alone, for two sections side by side under one divider. */
export function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-caption font-semibold tracking-[0.08em] text-slate-600 uppercase">{children}</h3>
}

export function BodySkeleton({ strip = true }: { strip?: boolean }) {
  return (
    <div className="mt-6 border-t border-slate-100 pt-5" aria-busy="true">
      {strip && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-[5.5rem]" />
          <Skeleton className="h-[5.5rem]" />
          <Skeleton className="h-[5.5rem]" />
        </div>
      )}
      <Skeleton className="mt-5 h-4 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
    </div>
  )
}

export interface ChipItem {
  key: string
  text: string
  tone: 'pos' | 'neg' | null
}

const CHIP_TONE = {
  pos: 'bg-pos-50 text-slate-800 ring-pos-500/25',
  neg: 'bg-neg-50 text-neg-600 ring-neg-500/25',
  none: 'bg-slate-50 text-slate-700 ring-slate-200',
} as const

/** Read-only chips: green tint for a strength or an improvement, red for a
 * weakness or a deterioration (direction-aware, DESIGN.md). */
export function ChipList({ chips }: { chips: ChipItem[] }) {
  if (chips.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.key} data-badge="sm" title={chip.text} className={`${badgeClassName('sm', CHIP_TONE[chip.tone ?? 'none'])} tabular-nums`}>
          {chip.tone === 'pos' && <Dot tone="pos" />}
          <span className="min-w-0 truncate">{chip.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** A quiet sentence under a section. */
export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-small text-slate-600 ${className}`}>{children}</p>
}
