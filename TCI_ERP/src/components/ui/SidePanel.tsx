/**
 * A side panel (Prompt 30, phase 2): what a person reads while looking at a
 * list opens beside it instead of over it — a row's quick view in a registry
 * or a queue. Non-modal: the list stays visible and scrollable, a click on
 * another row swaps the content, Escape or the close button dismisses it.
 * Modals stay for short confirmations and small forms.
 *
 * It enters with productive motion (150 ms, ease-out) and not at all under
 * `prefers-reduced-motion`.
 */

import { Eye, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface SidePanelProps {
  open: boolean
  title: ReactNode
  /** One line under the title (a number, a status). */
  meta?: ReactNode
  onClose: () => void
  /** The way to the full page, and the primary action. */
  footer?: ReactNode
  children: ReactNode
}

export function SidePanel({ open, title, meta, onClose, footer, children }: SidePanelProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <aside
      role="complementary"
      aria-labelledby={titleId}
      data-side-panel
      className="animate-panel-in fixed top-0 right-0 bottom-0 z-40 flex w-full max-w-[28rem] flex-col border-l border-slate-200 bg-white shadow-pop"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lead font-semibold text-slate-900">
            {title}
          </h2>
          {meta && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-small text-slate-500">
              {meta}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {footer}
        </footer>
      )}
    </aside>
  )
}

/**
 * The «eye» that opens a row's quick view (Table v2): an icon button in the
 * row's action cell (`RowActions reveal`, sized `actionsCol([], 1)`), named
 * after the row for a screen reader. A row click still opens the full page.
 */
export function QuickViewButton({ name, onClick }: { name: string; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('ui.quickView.open', { name })}
      title={t('ui.quickView.label')}
      className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500"
    >
      <Eye className="size-4" aria-hidden />
    </button>
  )
}
