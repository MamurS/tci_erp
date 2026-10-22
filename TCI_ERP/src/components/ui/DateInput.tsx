/**
 * The date field: typed day first with a mask (ДД.ММ.ГГГГ), or picked on a
 * calendar in the interface language, Monday first. It never takes the
 * browser's own date format — a native <input type="date"> showed
 * «mm/dd/yyyy» in a Russian interface. The value is an ISO date
 * ('2026-10-21', '' when empty); dateEntry.ts holds the rules.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import {
  datePattern,
  isoToMasked,
  maskDate,
  monthGrid,
  monthTitle,
  parseDate,
  todayIso,
  weekdayNames,
} from './dateEntry'

interface DateInputProps {
  /** ISO date, '' when empty. */
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  required?: boolean
  className?: string
  'aria-label'?: string
}

export function DateInput({
  value,
  onChange,
  min,
  max,
  disabled = false,
  invalid = false,
  autoFocus,
  required,
  className = '',
  'aria-label': ariaLabel,
}: DateInputProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const [text, setText] = useState(() => isoToMasked(value, locale))
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const base = value || todayIso()
    return { year: Number(base.slice(0, 4)), month0: Number(base.slice(5, 7)) - 1 }
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const gridId = useId()

  // The value changed from outside (a reset, a prefill, a new language).
  useEffect(() => {
    if (parseDate(text) !== (value || null)) setText(isoToMasked(value, locale))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an outside change re-masks
  }, [value, locale])

  const outOfRange = (iso: string) => Boolean((min && iso < min) || (max && iso > max))
  const incomplete = text !== '' && parseDate(text) === null
  const bad = invalid || incomplete || Boolean(value && outOfRange(value))

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const height = 320
      const below = window.innerHeight - r.bottom
      setPos({ left: Math.min(r.left, window.innerWidth - 296), top: below < height && r.top > height ? r.top - height - 4 : r.bottom + 4 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (iso: string) => {
    if (outOfRange(iso)) return
    setText(isoToMasked(iso, locale))
    onChange(iso)
    setOpen(false)
  }

  const openCalendar = () => {
    const base = value || todayIso()
    setView({ year: Number(base.slice(0, 4)), month0: Number(base.slice(5, 7)) - 1 })
    setOpen(true)
  }

  const shift = (delta: number) =>
    setView((v) => {
      const m = v.month0 + delta
      return { year: v.year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 }
    })

  const today = todayIso()

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        placeholder={datePattern(locale)}
        value={text}
        onChange={(e) => {
          const masked = maskDate(e.target.value, locale)
          // Deleting a separator deletes the digit before it, not nothing.
          const next = e.target.value.length < text.length && masked === text ? maskDate(text.replace(/\D/g, '').slice(0, -1), locale) : masked
          setText(next)
          const iso = parseDate(next)
          onChange(iso ?? '')
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && (e.altKey || !open)) {
            e.preventDefault()
            openCalendar()
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            setOpen(false)
          }
        }}
        className={`num h-9 w-full rounded-md border bg-white py-1.5 pr-9 pl-3 text-sm text-slate-900 tabular-nums shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 ${
          bad ? 'border-neg-500' : 'border-slate-300'
        }`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        aria-label={t('date.openCalendar')}
        aria-expanded={open}
        aria-controls={gridId}
        className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-accent-600 disabled:pointer-events-none"
      >
        <CalendarDays className="size-4" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            id={gridId}
            role="dialog"
            aria-label={t('date.openCalendar')}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: 288 }}
            className="animate-fade-in z-[60] rounded-lg border border-slate-200 bg-white p-3 shadow-pop"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                e.nativeEvent.stopImmediatePropagation()
                setOpen(false)
              }
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => shift(-1)}
                aria-label={t('date.previousMonth')}
                className="flex size-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-[13px] font-semibold text-slate-800">{monthTitle(view.year, view.month0, locale)}</span>
              <button
                type="button"
                onClick={() => shift(1)}
                aria-label={t('date.nextMonth')}
                className="flex size-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {weekdayNames(locale).map((d) => (
                <span key={d} className="py-1 text-[11px] font-medium text-slate-400">
                  {d}
                </span>
              ))}
              {monthGrid(view.year, view.month0).map((iso, i) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    disabled={outOfRange(iso)}
                    onClick={() => pick(iso)}
                    className={`h-8 rounded text-[13px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
                      iso === value
                        ? 'bg-accent-600 font-semibold text-white'
                        : iso === today
                          ? 'font-semibold text-accent-700 ring-1 ring-accent-300 hover:bg-accent-50'
                          : 'text-slate-700 hover:bg-accent-50'
                    }`}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                ) : (
                  <span key={`e${i}`} />
                ),
              )}
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => pick(today)}
                disabled={outOfRange(today)}
                className="text-[12.5px] font-medium text-accent-600 hover:underline disabled:text-slate-300"
              >
                {t('date.today')}
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    setText('')
                    onChange('')
                    setOpen(false)
                  }}
                  className="text-[12.5px] text-slate-500 hover:underline"
                >
                  {t('picker.clear')}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
