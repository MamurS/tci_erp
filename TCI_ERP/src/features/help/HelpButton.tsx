/**
 * The ways into the user guide from any screen: the «?» in the top bar (staff
 * and portal), F1 anywhere (useHelpHotkey.ts), and the small «?» beside a page
 * title. Each opens the guide's topic for the page that is open — the one
 * written for the reader's acting role first — or the Help home when the page
 * has none.
 */
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CircleHelp } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { helpHrefFor, helpTopicsFor } from './pages'
import { isHelpPath, useHelpHref } from './useHelpHotkey'

/** The «?» in the top bar. `inverse` on the portal's navy header. */
export function HelpButton({ inverse = false }: { inverse?: boolean }) {
  const { t } = useTranslation()
  const href = useHelpHref()
  return (
    <Link
      to={href}
      aria-label={t('help.openForPage')}
      title={`${t('help.openForPage')} (F1)`}
      data-tour="help"
      data-testid="help-button"
      className={`flex size-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        inverse ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <CircleHelp className="size-5" strokeWidth={2} />
    </Link>
  )
}

/** The small «?» beside a page title: the guide's topic for this page (nothing when there is none). */
export function PageHelpLink({ inverse = false }: { inverse?: boolean }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { actingRole } = useAuth()
  if (isHelpPath(pathname) || !helpTopicsFor(pathname, actingRole).length) return null
  return (
    <Link
      to={helpHrefFor(pathname, actingRole)}
      aria-label={t('help.openForPage')}
      title={t('help.openForPage')}
      data-testid="page-help"
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors print:hidden ${
        inverse ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      <CircleHelp className="size-4" strokeWidth={2} />
    </Link>
  )
}
