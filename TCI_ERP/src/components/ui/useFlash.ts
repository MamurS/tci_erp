/**
 * Inline confirmation (Prompt 30, phase 2): after a save the button itself
 * becomes a check for about a second — instead of a toast that covers the
 * content. `flash()` starts it; `on` is true while it shows.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export const FLASH_MS = 1200

export function useFlash(ms = FLASH_MS): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(true)
    timer.current = window.setTimeout(() => setOn(false), ms)
  }, [ms])
  return [on, flash]
}
