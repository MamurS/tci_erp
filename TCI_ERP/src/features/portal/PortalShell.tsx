/**
 * The portal's frame. Same design system as the staff app - a policyholder
 * should not feel handed off to a different product - but a deliberately
 * plainer one: a few destinations, no badges, no queues, no counts. Nothing
 * here hints at the internal workflow behind it.
 */

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { PageLoading } from '../../components/layout/PageLoading'
import { SignInNotice } from '../../auth/SignInNotice'
import { NewVersionNotice } from '../../components/layout/NewVersionNotice'
import { useNewVersion } from '../../lib/useNewVersion'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { BrandMark, TablePrefsContext } from '../../components/ui'
import { LanguageSwitcher } from '../../components/layout/LanguageSwitcher'
import { PORTAL_NAV_ITEMS } from './navigation'
import { useMyEntity } from './api'

export function PortalShell() {
  const newVersion = useNewVersion()
  const { t } = useTranslation()
  const { session, signOut } = useAuth()
  // A policyholder reads a few rows at a time: relaxed rows by default.
  const userId = session?.user.id ?? 'anonymous'
  const tablePrefs = useMemo(() => ({ user: userId, defaultDensity: 'relaxed' as const }), [userId])
  const { data: entity } = useMyEntity()
  const headerRef = useRef<HTMLElement>(null)

  // The page reserves the scrollbar's gutter (index.css), and only the root
  // background paints there: without this the navy header would stop a
  // scrollbar's width short of the window edge. The root gets a navy band as
  // tall as the header, measured so it follows the header when it wraps.
  useEffect(() => {
    const root = document.documentElement
    const header = headerRef.current
    root.classList.add('portal-root')
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--portal-header-h', `${header?.offsetHeight ?? 0}px`),
    )
    if (header) observer.observe(header)
    return () => {
      observer.disconnect()
      root.classList.remove('portal-root')
      root.style.removeProperty('--portal-header-h')
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      <header ref={headerRef} data-brand-surface className="bg-gradient-to-r from-accent-700 to-accent-800 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <div className="flex flex-col">
            <BrandMark size="sm" inverse />
            <span className="mt-1 text-caption font-medium tracking-[0.18em] text-white/70 uppercase">
              {t('portal.title')}
            </span>
          </div>
          <div className="flex-1" />
          <div className="rounded-md bg-white/95 p-0.5">
            <LanguageSwitcher />
          </div>
          <div className="flex flex-col items-end leading-tight">
            {/* The company, not the role: a portal user has exactly one role
                and being told so every page is noise. */}
            <span className="text-small font-semibold">{entity?.name ?? session?.user.email}</span>
            {entity && <span className="text-caption text-white/70">{session?.user.email}</span>}
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-small text-white/80 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
            {t('auth.signOut')}
          </button>
        </div>
        <nav className="mx-auto flex w-full max-w-6xl flex-wrap gap-1 px-4">
          {PORTAL_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/portal'}
              className={({ isActive }) =>
                `border-b-[3px] px-3 py-3 text-body transition-colors ${
                  isActive
                    ? 'border-accent-400 font-semibold text-white'
                    : 'border-transparent text-white/70 hover:text-white'
                }`
              }
            >
              {t(`portal.nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
        <SignInNotice accountPath="/portal/account" />
        <TablePrefsContext.Provider value={tablePrefs}>
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </TablePrefsContext.Provider>
      </main>
      <NewVersionNotice stale={newVersion} />
    </div>
  )
}
