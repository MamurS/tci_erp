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
import { Portal } from './Overlay'
import { anchoredStyle, remToPx, useAnchoredPlacement, useDismiss, useLayerZ } from './overlayHooks'

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
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const zIndex = useLayerZ('dropdown')
  // Portalled to <body> and FIXED beside its button (Overlay.tsx): a table's
  // scrolling card, a row or the top bar can neither clip it nor grow a
  // scrollbar for it; it follows its button when the page scrolls and opens
  // upwards near the bottom of the screen.
  const place = useAnchoredPlacement(wrapRef, open, { align: 'end', width: remToPx(16) })
  useDismiss(open, [wrapRef, menuRef], () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ) ?? []),
        ]
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The first item takes focus once the menu is placed.
  const placed = open && place !== null
  useEffect(() => {
    if (placed)
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus({ preventScroll: true })
  }, [placed])

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
      className={`flex w-full items-center px-4 py-2 text-left text-small focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
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
          setOpen((v) => !v)
        }}
      >
        {trigger === 'icon' ? (
          <MoreHorizontal aria-hidden />
        ) : (
          <>
            {label ?? t('common.actions')}
            <ChevronDown aria-hidden className="text-slate-500" />
          </>
        )}
      </Button>
      {open && place && (
        <Portal layer="dropdown">
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            data-overlay="menu"
            style={anchoredStyle(place, zIndex)}
            className="animate-fade-in scrollbar-thin overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop"
          >
            {ordinary.map(item)}
            {danger.length > 0 && (
              <div
                role="group"
                className={ordinary.length ? 'mt-1 border-t border-slate-100 pt-1' : ''}
              >
                {danger.map(item)}
              </div>
            )}
          </div>
        </Portal>
      )}
    </div>
  )
}
