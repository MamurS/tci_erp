/**
 * Validation on blur (Prompt 30, phase 2): a field is checked when the
 * person LEAVES it, never on every keystroke, and its message stays until
 * the value is right. Submitting marks every field as left, so whatever is
 * still wrong is named at once. The checks return i18n keys
 * (`ui.validation.*`), never text.
 */

import { useCallback, useState } from 'react'

export type ValidationKey = 'required' | 'email' | 'url'

export function checkRequired(value: string): ValidationKey | null {
  return value.trim() ? null : 'required'
}

/** Empty is fine (the field is optional); otherwise one @ with text either
 * side and a dot in the domain. */
export function checkEmail(value: string): ValidationKey | null {
  const v = value.trim()
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'email'
}

/** Empty is fine; otherwise an http(s) address with a host that has a dot. */
export function checkUrl(value: string): ValidationKey | null {
  const v = value.trim()
  if (!v) return null
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    return url.hostname.includes('.') ? null : 'url'
  } catch {
    return 'url'
  }
}

/** Which fields have been left: `blur(name)` on leaving, `all()` on submit,
 * `reset()` when the form opens again. */
export function useTouched<K extends string>(): {
  touched: (key: K) => boolean
  blur: (key: K) => () => void
  all: () => void
  reset: () => void
} {
  const [left, setLeft] = useState<ReadonlySet<K> | 'all'>(new Set())
  const touched = useCallback((key: K) => left === 'all' || left.has(key), [left])
  const blur = useCallback(
    (key: K) => () =>
      setLeft((prev) => (prev === 'all' || prev.has(key) ? prev : new Set([...prev, key]))),
    [],
  )
  const all = useCallback(() => setLeft('all'), [])
  const reset = useCallback(() => setLeft(new Set()), [])
  return { touched, blur, all, reset }
}
