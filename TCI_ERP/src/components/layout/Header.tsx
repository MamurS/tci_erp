import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, LogOut, Search, UserRound } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { LanguageSwitcher } from './LanguageSwitcher'
import { SidebarToggle } from './SidebarToggle'
import { navIcon } from './navIcons'
import { sectionFor } from './shell'

interface HeaderProps {
  onOpenPalette: () => void
  /**
   * What sits at the top bar's left edge: nothing (pinned panel), a blank of
   * the toggle's size (desktop, hidden panel — the fixed toggle of AppShell
   * is drawn over it), or the drawer's open button (small screens).
   */
  toggleSlot: 'none' | 'spacer' | 'button'
  /** Opens the drawer (toggleSlot 'button'). */
  onShowSidebar: () => void
  /** id of the panel the drawer button controls. */
  sidebarId: string
}

/** Initials for the avatar: first letters of the e-mail's local part words. */
function initials(email: string | undefined): string {
  if (!email) return '·'
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || local[0]?.toUpperCase() || '·'
}

export function Header({ onOpenPalette, toggleSlot, onShowSidebar, sidebarId }: HeaderProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const section = sectionFor(pathname)
  const SectionIcon = section ? navIcon(section.key) : null
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const { session, actingRole, heldRoles, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const email = session?.user.email

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur sm:gap-4 sm:px-6">
      {/* 20px in and centred 32px down — the toggle's one position. */}
      {toggleSlot === 'spacer' && <span aria-hidden className="-ml-1 size-9 shrink-0" />}
      {toggleSlot === 'button' && (
        <div className="-ml-1">
          <SidebarToggle action="show" tone="plain" expanded={false} controls={sidebarId} onClick={onShowSidebar} />
        </div>
      )}
      {section && SectionIcon && (
        <Link
          to={section.path}
          className="hidden shrink-0 items-center gap-2 font-display text-[16px] font-bold tracking-wide text-accent-600 uppercase hover:text-accent-500 md:flex"
        >
          <SectionIcon className="size-[18px] text-accent-500" strokeWidth={2} />
          {t(`nav.${section.key}`)}
        </Link>
      )}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label={t('palette.trigger')}
        className="flex h-9 shrink-0 items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-left text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-white sm:w-full sm:max-w-md sm:shrink sm:px-3"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 truncate sm:inline">{t('palette.trigger')}</span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 sm:inline">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="flex-1" />
      <LanguageSwitcher />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-2.5 rounded-md py-1 pr-1.5 pl-1 transition-colors hover:bg-slate-100"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-600 text-[12px] font-bold text-white">
            {initials(email)}
          </span>
          <span className="hidden max-w-[220px] flex-col items-start leading-tight md:flex">
            <span className="w-full truncate text-[13px] font-semibold text-slate-800">{email}</span>
            {/* The acting role (0063): what the database answers for now. */}
            <span className="w-full truncate text-[11px] text-slate-500" data-testid="acting-role">
              {actingRole
                ? heldRoles.length > 1
                  ? t('roles.actingAs', { role: t(`roles.${actingRole}`) })
                  : t(`roles.${actingRole}`)
                : t('roles.unassigned')}
            </span>
          </span>
          <ChevronDown className="size-4 text-slate-400" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="animate-fade-in absolute right-0 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-pop"
          >
            <div className="border-b border-slate-100 px-3.5 py-2.5">
              <div className="truncate text-[13px] font-semibold text-slate-800">{email}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
                {actingRole ? t('roles.actingAs', { role: t(`roles.${actingRole}`) }) : t('roles.unassigned')}
              </div>
              {heldRoles.length > 1 && (
                <div className="mt-1 text-[11px] leading-snug text-slate-400">
                  {t('roles.held', { roles: heldRoles.map((r) => t(`roles.${r}`)).join(', ') })}
                </div>
              )}
            </div>
            {/* Password, second factor and sessions live on the account page. */}
            <Link
              to="/account"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
            >
              <UserRound className="size-4 text-slate-400" />
              {t('account.title')}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="size-4 text-slate-400" />
              {t('auth.signOut')}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
