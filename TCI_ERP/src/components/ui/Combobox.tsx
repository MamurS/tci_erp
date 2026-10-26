/**
 * A search field that suggests as you type — the picker for anything chosen
 * out of a long list (a company out of the registry). Nothing is listed
 * until something is typed (↓ opens the list on demand); suggestions drop
 * down under the field with the matching letters in bold, ↑ ↓ Enter pick,
 * Escape closes the list without closing the dialog around it. The list is
 * rendered in a portal, positioned on the field, so a modal never clips it.
 *
 * Free-text mode (`text` + `onTextChange`) keeps what was typed as a value of
 * its own when nothing is picked — a buyer not in the registry yet.
 * Matching and highlighting: combobox.ts.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'

import { highlight, matchOptions } from './combobox'
import type { ComboMatchable } from './combobox'

export interface ComboOption extends ComboMatchable {
  /** A second line under the label: country, registration number… */
  meta?: ReactNode
}

interface ComboboxProps {
  /** The picked option's id, or null. */
  value: string | null
  onChange: (id: string | null) => void
  options: readonly ComboOption[]
  placeholder?: string
  /** Searched for on focus while nothing is picked (e.g. the name a client gave). */
  seedQuery?: string
  /** Free-text mode: what was typed, kept when nothing is picked. */
  text?: string
  onTextChange?: (text: string) => void
  /** A badge inside the field while the value is free text. */
  freeTextBadge?: ReactNode
  /** Under the suggestions — e.g. «request this company» when it is missing. */
  renderFooter?: (query: string, close: () => void) => ReactNode
  disabled?: boolean
  autoFocus?: boolean
  /** A short, known list (countries): show it on focus, before typing. */
  openOnFocus?: boolean
  invalid?: boolean
  limit?: number
  'aria-label'?: string
}

interface Placement {
  left: number
  top: number
  width: number
  maxHeight: number
  above: boolean
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  seedQuery,
  text,
  onTextChange,
  freeTextBadge,
  renderFooter,
  disabled = false,
  autoFocus = false,
  openOnFocus = false,
  invalid = false,
  limit = 8,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const { t } = useTranslation()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const freeText = onTextChange !== undefined
  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value])

  // What the field shows: while typing, the query; at rest, the picked label
  // (or the free text).
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const shownText = editing ? query : (selected?.label ?? (freeText ? (text ?? '') : ''))
  const result = useMemo(() => matchOptions(options, query, limit), [options, query, limit])
  const footer = renderFooter?.(query.trim(), () => setOpen(false))

  const close = () => {
    setOpen(false)
    setEditing(false)
  }

  // Keep the list on the field: under it, or above when there is no room.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 12
      const flip = below < 220 && above > below
      setPlacement({
        left: r.left,
        top: flip ? r.top - 4 : r.bottom + 4,
        width: Math.max(r.width, 300),
        maxHeight: Math.min(flip ? above : below, 360),
        above: flip,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (inputRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
      setEditing(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => setActive(0), [query])

  const pick = (option: ComboOption) => {
    onChange(option.id)
    if (freeText) onTextChange('')
    setQuery('')
    close()
  }

  const clear = () => {
    onChange(null)
    if (freeText) onTextChange('')
    setQuery('')
    setEditing(true)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onType = (next: string) => {
    setQuery(next)
    setEditing(true)
    setOpen(openOnFocus || next.trim().length > 0)
    if (freeText) {
      // Typing over a pick turns the value back into text.
      if (value) onChange(null)
      onTextChange(next)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const count = result.shown.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setEditing(true)
        setQuery(editing ? query : '')
        setOpen(true)
        return
      }
      setActive((i) => (count ? (i + 1) % count : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (count ? (i - 1 + count) % count : 0))
    } else if (e.key === 'Enter') {
      if (open && result.shown[active]) {
        e.preventDefault()
        pick(result.shown[active])
      }
    } else if (e.key === 'Escape') {
      if (open || editing) {
        // The list closes; the dialog around it stays.
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        close()
      }
    } else if (e.key === 'Tab') {
      close()
    }
  }

  const showBadge = freeText && !value && (text ?? '').trim() !== '' && !open && freeTextBadge

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && result.shown[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder ?? t('picker.placeholder')}
        value={shownText}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => {
          if (!editing) {
            const seed = selected ? '' : freeText ? (text ?? '') : (seedQuery ?? '')
            setQuery(seed)
            setEditing(true)
            if ((!freeText && seed.trim()) || openOnFocus) setOpen(true)
          }
        }}
        onBlur={() => {
          // Leaving with a half-typed query keeps the pick (or the free text).
          if (!open) setEditing(false)
        }}
        onKeyDown={onKeyDown}
        className={`h-9 w-full rounded-md border bg-white py-1.5 pr-8 pl-8 text-sm text-slate-900 shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 ${
          invalid ? 'border-neg-500' : 'border-slate-300'
        } ${selected && !editing ? 'font-medium' : ''}`}
      />
      {showBadge && (
        <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2">{freeTextBadge}</span>
      )}
      {!disabled && (selected || (freeText && (text ?? '') !== '') || (editing && query !== '')) && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          aria-label={t('picker.clear')}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="size-3.5" />
        </button>
      )}

      {open &&
        placement &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            style={{
              position: 'fixed',
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.above
                ? { bottom: window.innerHeight - placement.top }
                : { top: placement.top }),
            }}
            className="animate-fade-in z-[60] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="scrollbar-thin overflow-y-auto py-1">
              {result.shown.map((option, index) => (
                <div
                  key={option.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(option)}
                  className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${
                    index === active ? 'bg-accent-50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8438rem] text-slate-700">
                      {highlight(option.label, query).map((part, i) =>
                        part.match ? (
                          <strong key={i} className="font-semibold text-slate-950">
                            {part.text}
                          </strong>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </div>
                    {option.meta && <div className="mt-0.5 truncate text-[0.75rem] text-slate-500">{option.meta}</div>}
                  </div>
                  {option.id === value && <Check className="mt-0.5 size-4 shrink-0 text-accent-600" />}
                </div>
              ))}
              {result.shown.length === 0 && (
                <div className="px-3 py-2.5 text-[0.8125rem] text-slate-500">{t('picker.noMatches')}</div>
              )}
              {result.more > 0 && (
                <div className="px-3 pt-1 pb-1.5 text-[0.75rem] text-slate-400">
                  {t('picker.more', { n: result.more })}
                </div>
              )}
            </div>
            {footer && <div className="shrink-0 border-t border-slate-100 bg-slate-50/70">{footer}</div>}
          </div>,
          document.body,
        )}
    </div>
  )
}
