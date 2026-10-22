/**
 * The show/hide state of a PasswordInput, kept pure so it can be tested
 * without a DOM.
 *
 * The state remembers the reset key it was toggled under. A form that stays
 * on screen after a successful submit bumps the key (`revealResetKey`), and
 * the field reads as hidden from that render on — derived, no effect, so the
 * typed secret is never on screen for a frame after the save.
 */

export interface RevealState {
  visible: boolean
  /** The `revealResetKey` the field had when the person last toggled it. */
  resetKey: unknown
}

export const REVEAL_LABEL_KEYS = {
  show: 'auth.showPassword',
  hide: 'auth.hidePassword',
} as const

export function initialReveal(resetKey: unknown): RevealState {
  return { visible: false, resetKey }
}

/** Is the password shown now? Never while the field is disabled, and never
 * once the form has moved the reset key on since the last toggle. */
export function isRevealed(state: RevealState, resetKey: unknown, disabled = false): boolean {
  return !disabled && state.visible && Object.is(state.resetKey, resetKey)
}

/** The state after a click on the toggle (a disabled field does not toggle). */
export function toggleReveal(state: RevealState, resetKey: unknown, disabled = false): RevealState {
  if (disabled) return state
  return { visible: !isRevealed(state, resetKey), resetKey }
}

/** What the input and its toggle render for a state. */
export function revealView(visible: boolean): {
  type: 'text' | 'password'
  pressed: boolean
  labelKey: (typeof REVEAL_LABEL_KEYS)[keyof typeof REVEAL_LABEL_KEYS]
} {
  return visible
    ? { type: 'text', pressed: true, labelKey: REVEAL_LABEL_KEYS.hide }
    : { type: 'password', pressed: false, labelKey: REVEAL_LABEL_KEYS.show }
}

export const CAPS_LOCK_HINT_KEY = 'auth.capsLockOn' as const

/** The «Caps Lock is on» hint shows only while the field has focus AND the
 * last key event in it reported Caps Lock — never for a field you are not
 * typing in, and it goes away on blur. */
export function showCapsLockHint(focused: boolean, capsLock: boolean): boolean {
  return focused && capsLock
}
