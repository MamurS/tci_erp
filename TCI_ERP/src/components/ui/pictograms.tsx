/**
 * The pictogram set of empty states (Prompt 30, phase 2): our own line
 * drawings, one style — 64 px box, 2 px rounded strokes, the neutral line with
 * ONE brand accent (sky) per drawing. No third-party art. Each is decorative
 * (`aria-hidden`); the empty state's words carry the meaning.
 */

import type { ReactElement } from 'react'

import type { PictogramName } from './pictogramNames'

const LINE = 'var(--color-slate-400)'
const ACCENT = 'var(--color-sky-400)'
const FILL = 'var(--color-sky-50)'

const S = {
  fill: 'none',
  stroke: LINE,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const
const A = { ...S, stroke: ACCENT } as const

const DRAWINGS: Record<PictogramName, ReactElement> = {
  companies: (
    <>
      <rect x="10" y="20" width="22" height="34" rx="2" {...S} />
      <rect
        x="32"
        y="10"
        width="22"
        height="44"
        rx="2"
        fill={FILL}
        stroke={ACCENT}
        strokeWidth={2}
      />
      <path
        d="M16 28h4M24 28h2M16 36h4M24 36h2M16 44h4M24 44h2M38 18h4M46 18h2M38 26h4M46 26h2M38 34h4M46 34h2"
        {...S}
      />
      <path d="M40 54v-8h6v8M6 54h52" {...S} />
    </>
  ),
  documents: (
    <>
      <path
        d="M18 12h20l10 10v30a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z"
        fill={FILL}
        stroke={ACCENT}
        strokeWidth={2}
      />
      <path d="M38 12v10h10" {...A} />
      <path d="M23 30h18M23 37h18M23 44h11" {...S} />
      <path d="M12 18v34a4 4 0 0 0 4 4h26" {...S} />
    </>
  ),
  limits: (
    <>
      <path
        d="M32 8l20 7v14c0 13-8.5 22-20 27-11.5-5-20-14-20-27V15z"
        fill={FILL}
        stroke={ACCENT}
        strokeWidth={2}
      />
      <path d="M23 32l6 6 12-13" {...S} />
    </>
  ),
  claims: (
    <>
      <path
        d="M8 20a2 2 0 0 1 2-2h14l4 5h26a2 2 0 0 1 2 2v25a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z"
        {...S}
      />
      <circle cx="40" cy="38" r="11" fill={FILL} stroke={ACCENT} strokeWidth={2} />
      <path d="M40 32v7M40 43v.5" {...A} />
    </>
  ),
  allDone: (
    <>
      <rect x="12" y="10" width="40" height="44" rx="4" {...S} />
      <path d="M20 22h10M20 32h10M20 42h10" {...S} />
      <circle cx="42" cy="40" r="10" fill={FILL} stroke={ACCENT} strokeWidth={2} />
      <path d="M37.5 40l3 3 6-6.5" {...A} />
      <path d="M38 22l3 3 5-5" {...S} />
    </>
  ),
  search: (
    <>
      <circle cx="28" cy="28" r="15" fill={FILL} stroke={ACCENT} strokeWidth={2} />
      <path d="M39 39l14 14" {...S} />
      <path d="M21 28h14" {...S} />
    </>
  ),
  chart: (
    <>
      <path d="M10 54h46M12 10v44" {...S} />
      <rect x="18" y="34" width="8" height="16" rx="1" {...S} />
      <rect
        x="31"
        y="24"
        width="8"
        height="26"
        rx="1"
        fill={FILL}
        stroke={ACCENT}
        strokeWidth={2}
      />
      <rect x="44" y="16" width="8" height="34" rx="1" {...S} />
    </>
  ),
  inbox: (
    <>
      <path
        d="M8 36l7-20a2 2 0 0 1 2-1h30a2 2 0 0 1 2 1l7 20v14a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z"
        {...S}
      />
      <path d="M8 36h14l3 6h14l3-6h14" fill={FILL} stroke={ACCENT} strokeWidth={2} />
    </>
  ),
  error: (
    <>
      <path d="M32 10l24 42H8z" fill={FILL} stroke={ACCENT} strokeWidth={2} />
      <path d="M32 26v12M32 45v.5" {...S} />
    </>
  ),
}

export function Pictogram({
  name,
  className = 'size-16',
}: {
  name: PictogramName
  className?: string
}) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      {DRAWINGS[name]}
    </svg>
  )
}
