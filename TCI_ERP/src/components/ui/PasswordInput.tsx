/**
 * A password field with a «Показать пароль» toggle — the ONLY password
 * control in the app (passwordReveal.test.ts refuses a bare
 * `type="password"` anywhere else).
 *
 * It is the `Input` primitive, unchanged, with room on the right (`pr-10`)
 * for an eye button laid over it. The button is absolutely positioned and of
 * a fixed size, so showing or hiding never moves or resizes anything
 * (DESIGN.md «No layout shift on interaction»); the swap is only the input's
 * `type`, which keeps its font, letter spacing and height.
 *
 * Every prop reaches the <input> (name, id, autoComplete, required,
 * minLength, value/onChange, aria-*, disabled, className, ref), so password
 * managers and validation see exactly the field they saw before. Width
 * constraints go on `containerClassName`, which also carries the button.
 *
 * Hidden again after a successful submit: a form that stays on screen passes
 * `revealResetKey` and changes it on success (see passwordReveal.ts). The
 * state lives in the component, so a field that unmounts comes back hidden.
 *
 * «Caps Lock is on» shows under the field while it has focus and the last
 * key pressed in it reported Caps Lock. Its line is reserved from the first
 * render, so the hint appearing or going never moves anything below.
 */

import { useContext, useId, useState } from 'react'
import type { ComponentProps, KeyboardEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FieldLabelIdContext } from './fieldContext'
import { Input } from './primitives'
import {
  CAPS_LOCK_HINT_KEY,
  initialReveal,
  isRevealed,
  revealView,
  showCapsLockHint,
  toggleReveal,
} from './passwordReveal'

export interface PasswordInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  /** Change it (a counter, a timestamp) after a successful submit: the field
   * goes back to hidden. Forms that leave the screen on success need none. */
  revealResetKey?: unknown
  /** Classes of the wrapper that holds the input and the toggle. */
  containerClassName?: string
}

export function PasswordInput({
  revealResetKey,
  containerClassName = '',
  className = '',
  id,
  disabled,
  onKeyDown,
  onKeyUp,
  onFocus,
  onBlur,
  ...rest
}: PasswordInputProps) {
  const { t } = useTranslation()
  const generatedId = useId()
  const inputId = id ?? generatedId
  // Named by the Field's caption alone, not «caption + the eye's label»
  // (fieldContext.ts); a name the caller gives wins.
  const fieldLabelId = useContext(FieldLabelIdContext)
  const labelledBy = rest['aria-labelledby'] ?? (rest['aria-label'] ? undefined : fieldLabelId)
  const [state, setState] = useState(() => initialReveal(revealResetKey))
  const view = revealView(isRevealed(state, revealResetKey, disabled))
  const label = t(view.labelKey)
  const Icon = view.pressed ? EyeOff : Eye

  const [focused, setFocused] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const capsHintId = `${inputId}-caps`
  const capsHint = showCapsLockHint(focused, capsLock)
  const readCapsLock = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState('CapsLock'))
  const describedBy =
    [rest['aria-describedby'], capsHint ? capsHintId : undefined].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={`w-full ${containerClassName}`}>
      <div className="relative w-full">
        <Input
          {...rest}
          id={inputId}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          type={view.type}
          disabled={disabled}
          className={`pr-10 ${className}`}
          onKeyDown={(e) => {
            readCapsLock(e)
            onKeyDown?.(e)
          }}
          onKeyUp={(e) => {
            readCapsLock(e)
            onKeyUp?.(e)
          }}
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            onBlur?.(e)
          }}
        />
        <button
          type="button"
          aria-controls={inputId}
          aria-pressed={view.pressed}
          aria-label={label}
          title={label}
          disabled={disabled}
          // Keep the caret in the field when the toggle is clicked with a
          // mouse; Tab still reaches the button and Enter / Space toggle it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setState((s) => toggleReveal(s, revealResetKey, disabled))}
          className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-accent-600 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-500"
        >
          <Icon aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </div>
      {/* Always rendered at a fixed height: the hint fills it, never adds it. */}
      <p
        id={capsHintId}
        aria-live="polite"
        className="mt-1 h-4 truncate text-xs leading-4 text-slate-600"
      >
        {capsHint && (
          <>
            {/* Amber as a dot, never as text colour (DESIGN.md). */}
            <span
              aria-hidden
              className="mr-1.5 inline-block size-1.5 rounded-full bg-warn-500 align-middle"
            />
            {t(CAPS_LOCK_HINT_KEY)}
          </>
        )}
      </p>
    </div>
  )
}
