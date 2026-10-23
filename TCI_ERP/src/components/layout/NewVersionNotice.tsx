/**
 * «A new version is available — reload». Shown in a tab that still runs the
 * build from before the last deploy (src/lib/appVersion.ts). It floats in
 * the corner instead of pushing the page down: it appears on its own, and
 * nothing the person is looking at may move because of it.
 *
 * Reload is a person's choice here — the page may hold unsaved input. The
 * sign-in page reloads by itself instead (LoginPage), where an untouched
 * form loses nothing.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, X } from 'lucide-react'

import { Button } from '../ui'

export function NewVersionNotice({ stale }: { stale: boolean }) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  if (!stale || dismissed) return null

  return (
    <div
      role="status"
      data-testid="new-version-notice"
      className="animate-fade-in fixed right-4 bottom-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-[13.5px] text-slate-700 shadow-pop"
    >
      <RefreshCw className="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-800">{t('app.newVersion.title')}</p>
        <p className="mt-0.5 text-slate-600">{t('app.newVersion.body')}</p>
        <Button size="sm" className="mt-3" onClick={() => window.location.reload()}>
          {t('app.newVersion.reload')}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
        aria-label={t('app.newVersion.later')}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
