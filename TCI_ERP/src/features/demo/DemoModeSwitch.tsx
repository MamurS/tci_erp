/** The person's demo-mode switch (0096): the user menu, the account pages and
 * the dashboard. A demo account has no real world to go to, so it gets a line
 * saying so instead of a switch. */

import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'

import { useDemoState, useSetDemoMode } from './api'
import { inDemoWorld, mayToggleDemo } from './model'

interface DemoModeSwitchProps {
  /** the user menu and the dashboard: one line, no hint */
  compact?: boolean
  /** false in the portal: a real policyholder has nothing in the demo world */
  offerSwitch?: boolean
}

export function DemoModeSwitch({ compact = false, offerSwitch = true }: DemoModeSwitchProps) {
  const { t } = useTranslation()
  const labelId = useId()
  const { data: state } = useDemoState()
  const save = useSetDemoMode()
  if (!state) return null
  const on = inDemoWorld(state)

  if (!mayToggleDemo(state)) {
    return (
      <p className="flex items-center gap-2 text-small text-slate-600">
        <FlaskConical className="size-4 shrink-0 text-warning-700" aria-hidden />
        {t('demo.mode.demoAccount')}
      </p>
    )
  }
  if (!offerSwitch) return null

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="flex items-center gap-2 text-small font-semibold text-slate-800">
          <FlaskConical className="size-4 shrink-0 text-slate-500" aria-hidden />
          {t('demo.mode.label')}
        </p>
        {!compact && (
          <p className="mt-1 text-small leading-relaxed text-slate-600">{t('demo.mode.hint')}</p>
        )}
        {save.isError && (
          <p role="alert" className="mt-1 text-small text-danger-700">
            {t('demo.mode.saveFailed')}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        data-testid="demo-mode-switch"
        disabled={save.isPending}
        onClick={() => save.mutate(!on)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none disabled:opacity-60 ${
          on ? 'border-warning-700 bg-warning-700' : 'border-slate-300 bg-slate-200'
        }`}
      >
        <span
          aria-hidden
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  )
}

/** The dashboard's toggle, on the navy band: one outlined chip. */
export function DemoModeChip() {
  const { t } = useTranslation()
  const { data: state } = useDemoState()
  const save = useSetDemoMode()
  if (!state || !mayToggleDemo(state)) return null
  const on = inDemoWorld(state)
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="demo-mode-chip"
      disabled={save.isPending}
      onClick={() => save.mutate(!on)}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-white/40 px-3 text-small font-semibold text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-60"
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      {on ? t('demo.mode.leave') : t('demo.mode.enter')}
    </button>
  )
}
