/**
 * A rating grade in the signature colour of the grade scale (Prompt 30):
 * the grade's tint with its ink — A1 teal … D red — the same on every screen,
 * in the Agenda, on cards and in tables. An unknown grade is neutral.
 */

import { useContext } from 'react'
import type { ReactNode } from 'react'

import { BadgeSizeContext, badgeClassName } from './badgeStyles'
import type { BadgeSize } from './badgeStyles'
import { gradeBadgeTone } from './gradeTone'

export function GradeBadge({
  grade,
  size,
  title,
  children,
}: {
  grade: string | null | undefined
  /** By default the size of the slot it sits in, as <Badge>. */
  size?: BadgeSize
  title?: string
  /** The label, when it says more than the grade («B1 · 42»). */
  children?: ReactNode
}) {
  const slot = useContext(BadgeSizeContext)
  if (!grade) return null
  const resolved = size ?? slot
  return (
    <span
      data-badge={resolved}
      data-grade={grade}
      title={title}
      className={badgeClassName(resolved, gradeBadgeTone(grade))}
    >
      {children ?? grade}
    </span>
  )
}
