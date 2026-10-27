/**
 * The hero band of a signature screen (Prompt 30, phase 3 — «bold fintech»):
 * a deep-navy band across the top of the page, edge to edge of the content
 * area, with the title in white display type, an eyebrow and a subtitle
 * above and below it, actions on the right, and the screen's key figures on
 * it as inverse KPI tiles. The trade mosaic of the TCI brochure (containers,
 * ships, cranes — our own drawings) fades in from the right edge.
 *
 * Children render on the navy: use `KpiCard tone="inverse"` for figures and
 * light text tokens (`text-white`, `text-accent-100`) for anything else.
 */

import type { ReactNode } from 'react'

import { OnBandContext } from './bandContext'
import { HERO_MOSAIC_URI } from './heroMosaic'

interface HeroBandProps {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Badges beside the title (a grade, a status). */
  status?: ReactNode
  actions?: ReactNode
  /** The key figures, laid out by the band in an even row. */
  children?: ReactNode
  /** Drawn without the mosaic (a print-like or very small band). */
  plain?: boolean
  /** Which page frame it sits in: the staff app's (py-6 / lg:py-7) or the
   * portal's (py-7). It runs up to the top bar, and sideways exactly as wide
   * as the content under it (owner, 2026-10-27: header and tables one
   * width), its own padding keeping the title in from the edge. */
  bleed?: 'app' | 'portal'
  /** A registry's or a queue's header: the same band, shorter, a smaller
   * title, no figure tiles. */
  compact?: boolean
  /** Figures in one line under the title — for a compact band on a screen
   * that needs its height (the Agenda's Triage fills the viewport). */
  stats?: readonly HeroStat[]
}

export interface HeroStat {
  key: string
  label: ReactNode
  value: ReactNode
  /** A dot before the figure: what it means (red overdue, amber today …). */
  dot?: 'danger' | 'warning' | 'success'
}

const DOT = {
  danger: 'bg-danger-400',
  warning: 'bg-warning-300',
  success: 'bg-success-400',
} as const

const BLEED = {
  app: '-mt-6 rounded-b-xl px-5 sm:px-6 lg:-mt-7',
  portal: '-mt-7 rounded-b-xl px-5 sm:px-6',
} as const

export function HeroBand({
  eyebrow,
  title,
  subtitle,
  status,
  actions,
  children,
  plain = false,
  bleed = 'app',
  compact = false,
  stats,
}: HeroBandProps) {
  return (
    <section
      data-hero
      data-brand-surface
      className={`relative mb-6 overflow-hidden bg-accent-900 bg-linear-to-br from-accent-900 via-accent-800 to-accent-700 text-white ${compact ? 'pt-6 pb-5' : 'pt-7 pb-6'} ${BLEED[bleed]}`}
    >
      {!plain && (
        <img
          src={HERO_MOSAIC_URI}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-auto max-w-none opacity-30 select-none [mask-image:linear-gradient(to_left,black_10%,transparent_75%)]"
        />
      )}
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* The figures of a compact band sit on the title's row, so the
              band stays one line tall (the Agenda's Triage needs the height). */}
          <div className="flex min-w-0 flex-wrap items-end gap-x-10 gap-y-4">
            <div className="min-w-0">
              {eyebrow && (
                <div className="mb-2 text-caption font-semibold tracking-wider text-sky-200 uppercase">
                  {eyebrow}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <h1
                  className={`min-w-0 font-display leading-tight font-bold text-white ${compact ? 'text-headline' : 'text-display'}`}
                >
                  {title}
                </h1>
                {status}
              </div>
              {subtitle && <div className="mt-2 text-body text-accent-100">{subtitle}</div>}
            </div>
            {stats && stats.length > 0 && (
              <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
                {stats.map((stat) => (
                  <div key={stat.key} className="flex flex-col gap-1">
                    <dt className="text-caption font-medium text-accent-100">{stat.label}</dt>
                    <dd className="flex items-center gap-2 font-display text-headline leading-none font-bold text-white tabular-nums">
                      {stat.dot && (
                        <span aria-hidden className={`size-2 rounded-full ${DOT[stat.dot]}`} />
                      )}
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {actions && (
            <OnBandContext.Provider value={true}>
              {/* The actions keep the theme's own colours on a light band
                  (palette.ts light chrome): white buttons, never inverted. */}
              <div data-chrome-actions className="flex flex-wrap items-center gap-2">
                {actions}
              </div>
            </OnBandContext.Provider>
          )}
        </div>
        {children && (
          // As many tiles to a row as fit at their least width, which grows
          // with the person's text size (uiScale.ts): a figure never cut.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,calc(10rem*var(--ui-text,1))),1fr))] gap-4">
            {children}
          </div>
        )}
      </div>
    </section>
  )
}
