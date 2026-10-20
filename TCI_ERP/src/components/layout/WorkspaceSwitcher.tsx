/**
 * The role-workspace switcher at the top of the sidebar. With one workspace
 * it is a label; with several (a person holding several roles, an admin) it
 * opens a list, and choosing one lands on that workspace's first tool.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown } from 'lucide-react'

import { workspaceIcon } from './navIcons'
import type { Workspace, WorkspaceKey } from './workspaces'

interface WorkspaceSwitcherProps {
  workspaces: readonly Workspace[]
  current: WorkspaceKey
  onSwitch: (key: WorkspaceKey) => void
}

export function WorkspaceSwitcher({ workspaces, current, onSwitch }: WorkspaceSwitcherProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const Icon = workspaceIcon(current)
  const several = workspaces.length > 1

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start text-left leading-tight">
        <span className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">
          {t('nav.workspace')}
        </span>
        <span className="mt-0.5 line-clamp-2 w-full text-[13px] font-semibold text-white">
          {t(`nav.workspaces.${current}.name`)}
        </span>
      </span>
    </>
  )

  if (!several) {
    return <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">{label}</div>
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/8"
      >
        {label}
        <ChevronsUpDown className="size-4 shrink-0 text-white/50" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('nav.workspace')}
          className="animate-fade-in absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-white/10 bg-accent-900 py-1 shadow-2xl shadow-black/40"
        >
          {workspaces.map((w) => {
            const ItemIcon = workspaceIcon(w.key)
            const selected = w.key === current
            return (
              <button
                key={w.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false)
                  if (!selected) onSwitch(w.key)
                }}
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/8 ${
                  selected ? 'bg-white/6' : ''
                }`}
              >
                <ItemIcon className="mt-0.5 size-4 shrink-0 text-white/70" strokeWidth={1.8} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-semibold text-white">{t(`nav.workspaces.${w.key}.name`)}</span>
                  <span className="text-[11px] leading-snug text-white/50">{t(`nav.workspaces.${w.key}.hint`)}</span>
                </span>
                {selected && <Check className="mt-0.5 size-4 shrink-0 text-accent-300" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
