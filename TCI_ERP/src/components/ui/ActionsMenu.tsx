/**
 * «Действия ▾»: an object's less frequent actions folded into one menu, so a
 * header keeps only the edit and the next step (one primary per view).
 * Destructive items sit in their own red section at the bottom and open their
 * confirmation — nothing here acts on a single click. Arrow keys move between
 * items, Escape closes. Styled like the user menu in the top bar.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MoreHorizontal } from 'lucide-react'

import { Button } from './primitives'

export interface MenuAction {
  key: string
  label: string
  onSelect: () => void
  /** Ends or undoes something: shown last, in red. */
  danger?: boolean
  disabled?: boolean
}

export function ActionsMenu({
  actions,
  label,
  disabled = false,
  trigger = 'button',
  size = 'md',
}: {
  actions: readonly MenuAction[]
  /** The button text; «Действия» by default. With trigger="icon" it is the
   * accessible name of the ⋯ button. */
  label?: string
  disabled?: boolean
  /** "icon": a square ⋯ button, for a row of compact actions. */
  trigger?: 'button' | 'icon'
  size?: 'md' | 'sm'
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Where the open menu sits, in the viewport: it is FIXED, so a table's
  // scrolling card cannot clip it or grow a scrollbar for it (that moved the
  // whole table when a row's menu opened near its bottom).
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setOpen(false)
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    // A fixed menu would drift from its button: scrolling closes it.
    const onScroll = () => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  if (!actions.length) return null
  const ordinary = actions.filter((a) => !a.danger)
  const danger = actions.filter((a) => a.danger)

  const item = (action: MenuAction) => (
    <button
      key={action.key}
      type="button"
      role="menuitem"
      disabled={action.disabled}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        setOpen(false)
        action.onSelect()
      }}
      // The highlight is the focus indicator (no ring), shown for keyboard
      // focus only: a menu opened by a click focuses its first item without
      // lighting it (lib/focusSource.ts).
      className={`flex w-full items-center px-3.5 py-2 text-left text-[0.8125rem] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        action.danger
          ? 'text-neg-500 hover:bg-neg-50 focus-visible:bg-neg-50'
          : 'text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50'
      }`}
    >
      {action.label}
    </button>
  )

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="secondary"
        size={size}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={trigger === 'icon' ? (label ?? t('common.actions')) : undefined}
        title={trigger === 'icon' ? (label ?? t('common.actions')) : undefined}
        className={trigger === 'icon' ? '!px-2' : ''}
        onClick={(e) => {
          // A menu inside a clickable row must not open the row too.
          e.stopPropagation()
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setPlace({ top: rect.bottom + 8, right: document.documentElement.clientWidth - rect.right })
          setOpen((v) => !v)
        }}
      >
        {trigger === 'icon' ? (
          <MoreHorizontal aria-hidden />
        ) : (
          <>
            {label ?? t('common.actions')}
            <ChevronDown aria-hidden className="text-slate-400" />
          </>
        )}
      </Button>
      {open && place && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={{ top: place.top, right: place.right }}
          className="animate-fade-in fixed z-50 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-pop"
        >
          {ordinary.map(item)}
          {danger.length > 0 && (
            <div role="group" className={ordinary.length ? 'mt-1 border-t border-slate-100 pt-1' : ''}>
              {danger.map(item)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
