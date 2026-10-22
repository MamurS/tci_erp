/**
 * «How it works» as a drawing: the policyholder sells to the buyer on credit,
 * pays the insurer a premium and receives cover and credit limits; the
 * insurer monitors the buyer. Labels come in the DOCUMENT's language (the
 * caller's `t`, from useFixedT), wrapped by diagram.ts because SVG text does
 * not wrap by itself. Brand colours from the tokens; no names.
 */

import { useId } from 'react'
import type { TFunction } from 'i18next'

import { DIAGRAM, wrapLabel } from './diagram'

const NAVY = 'var(--color-brand-navy)'
const BLUE = 'var(--color-brand-blue)'
const ORANGE = 'var(--color-brand-orange)'
const MUTED = 'var(--color-slate-500)'

interface LabelProps {
  x: number
  /** The vertical centre of the label block. */
  y: number
  text: string
  chars: number
  anchor: 'start' | 'middle' | 'end'
  /** 'down': the first line sits at y, further lines below it. */
  grow?: 'centre' | 'down' | 'up'
  bold?: boolean
}

const LINE = 16

function Label({ x, y, text, chars, anchor, grow = 'centre', bold = false }: LabelProps) {
  const lines = wrapLabel(text, chars)
  const first =
    grow === 'down'
      ? y
      : grow === 'up'
        ? y - (lines.length - 1) * LINE
        : y - ((lines.length - 1) * LINE) / 2
  return (
    <text
      x={x}
      y={first}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontSize={13}
      fontWeight={bold ? 700 : 400}
      fill="var(--color-ink)"
      stroke="#ffffff"
      strokeWidth={4}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : LINE}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

interface NodeProps {
  x: number
  y: number
  title: string
  subtitle: string
  tone: 'navy' | 'outline'
  stroke?: string
}

function Node({ x, y, title, subtitle, tone, stroke = NAVY }: NodeProps) {
  const { w, h } = DIAGRAM.node
  const filled = tone === 'navy'
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={filled ? NAVY : '#ffffff'}
        stroke={filled ? NAVY : stroke}
        strokeWidth={2}
      />
      <text
        x={x + w / 2}
        y={y + 26}
        textAnchor="middle"
        className="font-display"
        fontSize={18}
        fontWeight={700}
        letterSpacing="0.03em"
        fill={filled ? '#ffffff' : NAVY}
      >
        {title.toUpperCase()}
      </text>
      <text
        x={x + w / 2}
        y={y + 47}
        textAnchor="middle"
        fontSize={12}
        fill={filled ? '#dceff8' : MUTED}
      >
        {subtitle}
      </text>
    </g>
  )
}

export function HowItWorksDiagram({ t }: { t: TFunction }) {
  // One marker set per drawing: several brochures can be on one page.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const arrow = (colour: string) => `url(#${id}-${colour})`
  const { node, insurer: ins, policyholder: ph, buyer: by, chars } = DIAGRAM
  const markers: Record<string, string> = { navy: NAVY, blue: BLUE, orange: ORANGE, muted: MUTED }

  // Edges, from the node boxes (see DIAGRAM for the layout).
  const phRight = ph.x + node.w
  const sellY = ph.y + 20
  const payY = ph.y + 46
  const insBottom = ins.y + node.h

  return (
    <svg
      viewBox={`0 0 ${DIAGRAM.width} ${DIAGRAM.height}`}
      role="img"
      aria-label={t('brochure.diagram.aria')}
      className="block h-auto w-full font-sans"
    >
      <defs>
        {Object.entries(markers).map(([name, colour]) => (
          <marker
            key={name}
            id={`${id}-${name}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colour} />
          </marker>
        ))}
      </defs>

      {/* Policyholder → buyer: sells on credit; the buyer's payment back, dashed. */}
      <line
        x1={phRight}
        y1={sellY}
        x2={by.x - 2}
        y2={sellY}
        stroke={NAVY}
        strokeWidth={2}
        markerEnd={arrow('navy')}
      />
      <line
        x1={by.x}
        y1={payY}
        x2={phRight + 2}
        y2={payY}
        stroke={MUTED}
        strokeWidth={1.5}
        strokeDasharray="6 5"
        markerEnd={arrow('muted')}
      />

      {/* Policyholder → insurer: premium; insurer → policyholder: cover and limits. */}
      <line
        x1={175}
        y1={ph.y}
        x2={298}
        y2={insBottom + 2}
        stroke={ORANGE}
        strokeWidth={2.5}
        markerEnd={arrow('orange')}
      />
      <line
        x1={272}
        y1={insBottom}
        x2={150}
        y2={ph.y - 2}
        stroke={NAVY}
        strokeWidth={2}
        markerEnd={arrow('navy')}
      />

      {/* Insurer → buyer: monitoring and limits. */}
      <line
        x1={446}
        y1={insBottom}
        x2={568}
        y2={by.y - 2}
        stroke={BLUE}
        strokeWidth={2}
        markerEnd={arrow('blue')}
      />

      <Node
        x={ins.x}
        y={ins.y}
        title={t('brochure.diagram.insurer')}
        subtitle={t('brochure.diagram.insurerSub')}
        tone="navy"
      />
      <Node
        x={ph.x}
        y={ph.y}
        title={t('brochure.diagram.policyholder')}
        subtitle={t('brochure.diagram.policyholderSub')}
        tone="outline"
      />
      <Node
        x={by.x}
        y={by.y}
        title={t('brochure.diagram.buyer')}
        subtitle={t('brochure.diagram.buyerSub')}
        tone="outline"
        stroke={BLUE}
      />

      <Label
        x={DIAGRAM.width / 2}
        y={sellY - 10}
        text={t('brochure.diagram.sells')}
        chars={chars.bottom}
        anchor="middle"
        grow="up"
        bold
      />
      <Label
        x={DIAGRAM.width / 2}
        y={payY + 18}
        text={t('brochure.diagram.pays')}
        chars={chars.bottom}
        anchor="middle"
        grow="down"
      />
      <Label
        x={256}
        y={150}
        text={t('brochure.diagram.premium')}
        chars={chars.inner}
        anchor="start"
        bold
      />
      <Label
        x={196}
        y={150}
        text={t('brochure.diagram.cover')}
        chars={chars.side}
        anchor="end"
        bold
      />
      <Label
        x={522}
        y={150}
        text={t('brochure.diagram.monitoring')}
        chars={chars.side}
        anchor="start"
        bold
      />
    </svg>
  )
}
