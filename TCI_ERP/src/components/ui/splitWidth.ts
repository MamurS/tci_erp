/** The width of a split screen's left pane (SplitHandle.tsx): clamped,
 * kept per screen in this browser, in rem so it follows the zoom. */

import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'

const PREFIX = 'tci-erp-split:'

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    const n = raw === null ? NaN : Number.parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writeStored(key: string, rem: number | null) {
  try {
    if (rem === null) window.localStorage.removeItem(PREFIX + key)
    else window.localStorage.setItem(PREFIX + key, rem.toFixed(2))
  } catch {
    // storage unavailable: the width lasts for this page only
  }
}

export function rootRem(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/** Clamp a width in rem to [minRem, maxFraction × the container]. */
export function clampSplit(rem: number, minRem: number, containerRem: number, maxFraction: number): number {
  const max = Math.max(minRem, containerRem * maxFraction)
  return Math.min(Math.max(rem, minRem), max)
}

/** The person's width for a split screen, and the style that applies it. */
export function useSplitWidth(storageKey: string) {
  const [rem, setRem] = useState<number | null>(() => (typeof window === 'undefined' ? null : readStored(storageKey)))
  const update = useCallback(
    (next: number | null) => {
      setRem(next)
      writeStored(storageKey, next)
    },
    [storageKey],
  )
  const style = (rem === null ? {} : { '--split-w': `${rem}rem` }) as CSSProperties
  return { rem, setRem: update, style }
}

