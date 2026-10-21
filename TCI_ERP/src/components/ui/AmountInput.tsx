/**
 * An amount field that groups thousands as you type — 1,000,000 — with the
 * caret staying where it was, the currency shown inside the field, and the
 * figure right-aligned like it is in every table. The value handed back is
 * the plain decimal string ("1000000.5"); amount.ts does the arithmetic of
 * typing, pasting and the caret.
 */

import { useRef } from 'react'
import type { InputHTMLAttributes } from 'react'

import { cleanAmount, groupAmount, caretAfterGrouping, significantBefore } from './amount'

interface AmountInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** The plain value: digits and at most one point ("" when empty). */
  value: string
  onChange: (plain: string) => void
  /** Decimal places accepted: 2 for money, 0 for whole units. */
  decimals?: number
  allowNegative?: boolean
  /** Shown inside the field on the right: the currency code, «%», «дн.». */
  suffix?: string
  invalid?: boolean
}

export function AmountInput({
  value,
  onChange,
  decimals = 2,
  allowNegative = false,
  suffix,
  invalid = false,
  className = '',
  ...rest
}: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const display = groupAmount(value)

  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={display}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const raw = e.target.value
          const before = significantBefore(raw, e.target.selectionStart ?? raw.length)
          const plain = cleanAmount(raw, decimals, allowNegative)
          const at = caretAfterGrouping(groupAmount(plain), before)
          onChange(plain)
          // After React has written the grouped text back (also when a
          // rejected key left the value unchanged), put the caret where the
          // person was typing, not at the end.
          const el = e.target
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.setSelectionRange(at, at)
          })
        }}
        className={`num h-9 w-full rounded-md border bg-white py-1.5 pl-3 text-right text-sm text-slate-900 tabular-nums shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 ${
          suffix ? 'pr-12' : 'pr-3'
        } ${invalid ? 'border-neg-500' : 'border-slate-300'} ${className}`}
        {...rest}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] font-medium text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  )
}
