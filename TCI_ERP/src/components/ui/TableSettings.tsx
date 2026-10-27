/**
 * «Вид таблицы» (Prompt 30, phase 2): one small button beside a registry's
 * other controls that opens the person's table preferences — the row density
 * (every table) and which of THIS table's columns are shown. Remembered per
 * person in this browser (tablePrefs.ts); the first column (the name) is
 * never hidden, and «Сбросить» brings every column back.
 */

import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Segmented } from './primitives'
import { DENSITIES, useDensity, useHiddenColumns } from './tablePrefs'

export function TableSettings({
  table,
  columns,
}: {
  /** The id given to the Table whose columns this chooses. */
  table: string
  /** The column labels, in order; an empty label (an actions column) is not offered. */
  columns: readonly string[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [density, setDensity] = useDensity()
  const [hidden, setHidden] = useHiddenColumns(table)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

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
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (i: number) =>
    setHidden(hidden.includes(i) ? hidden.filter((h) => h !== i) : [...hidden, i])

  return (
    <div className="relative" ref={wrapRef}>
      {/* An icon button, so it fits beside a registry's filters on one line;
          the count of hidden columns rides on it. */}
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('ui.table.settings')}
        title={t('ui.table.settings')}
        className="!px-2"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal aria-hidden />
        {hidden.length > 0 && <span className="text-caption text-slate-600 tabular-nums">{hidden.length}</span>}
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('ui.table.settings')}
          className="animate-fade-in absolute top-full right-0 z-40 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-4 shadow-pop"
        >
          <p className="mb-2 text-caption font-semibold text-slate-600">{t('ui.table.density')}</p>
          <Segmented
            value={density}
            ariaLabel={t('ui.table.density')}
            options={DENSITIES.map((d) => ({ key: d, label: t(`ui.table.densities.${d}`) }))}
            onChange={(key) => setDensity(key as (typeof DENSITIES)[number])}
          />
          <p className="mt-4 mb-2 text-caption font-semibold text-slate-600">
            {t('ui.table.columns')}
          </p>
          <ul className="flex flex-col gap-1">
            {columns.map((label, i) =>
              label ? (
                <li key={i}>
                  <label className="flex items-center gap-2 text-small text-slate-700">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent-700"
                      checked={!hidden.includes(i)}
                      disabled={i === 0}
                      onChange={() => toggle(i)}
                    />
                    {label}
                  </label>
                </li>
              ) : null,
            )}
          </ul>
          {hidden.length > 0 && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setHidden(null)}>
              {t('ui.table.showAll')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
