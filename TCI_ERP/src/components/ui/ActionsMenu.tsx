/**
 * «Действия ▾»: an object's less frequent actions folded into one menu, so a
 * header keeps only the edit and the next step (one primary per view).
 * Destructive items sit in their own red section at the bottom and open their
 * confirmation — nothing here acts on a single click. Arrow keys move between
 * items, Escape closes. Styled like the user menu in the top bar.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

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
}: {
  actions: readonly MenuAction[]
  /** The button text; «Действия» by default. */
  label?: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
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
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
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
      onClick={() => {
        setOpen(false)
        action.onSelect()
      }}
      className={`flex w-full items-center px-3.5 py-2 text-left text-[13px] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        action.danger ? 'text-neg-500 hover:bg-neg-50 focus:bg-neg-50' : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-50'
      }`}
    >
      {action.label}
    </button>
  )

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="secondary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label ?? t('common.actions')}
        <ChevronDown aria-hidden className="text-slate-400" />
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="animate-fade-in absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-pop"
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
