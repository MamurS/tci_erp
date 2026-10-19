import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { CommandPalette } from './CommandPalette'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { isPaletteShortcut } from './commandPalette'
import { SIDEBAR_KEY, isSidebarShortcut, parseSidebarState } from './shell'
import type { SidebarState } from './shell'
import { PageLoading } from './PageLoading'
import { SignInNotice } from '../../auth/SignInNotice'

const DESKTOP = '(min-width: 1024px)'

function readSidebar(): SidebarState {
  try {
    return parseSidebarState(window.localStorage.getItem(SIDEBAR_KEY))
  } catch {
    return 'open'
  }
}

function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(DESKTOP).matches,
  )
  useEffect(() => {
    const query = window.matchMedia(DESKTOP)
    const onChange = () => setMatches(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return matches
}

/**
 * The staff frame. On a desktop the sidebar is docked or hidden (remembered
 * per browser); hidden, it can be peeked at by hovering the left edge or the
 * header button, and pinned back from there. Below 1024px it is a drawer.
 * Ctrl/⌘ B toggles it, Ctrl/⌘ K opens the command palette.
 */
export function AppShell() {
  const isDesktop = useIsDesktop()
  const [docked, setDocked] = useState<SidebarState>(readSidebar)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const leaveTimer = useRef<number | undefined>(undefined)
  const { pathname } = useLocation()

  const dock = useCallback((next: SidebarState) => {
    setDocked(next)
    setOverlayOpen(false)
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next)
    } catch {
      // a per-browser convenience; nothing to do when storage is blocked
    }
  }, [])

  const showDocked = isDesktop && docked === 'open'

  const toggle = useCallback(() => {
    if (isDesktop) dock(docked === 'open' ? 'closed' : 'open')
    else setOverlayOpen((v) => !v)
  }, [isDesktop, docked, dock])

  // A drawer never outlives the page it was opened on.
  useEffect(() => setOverlayOpen(false), [pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (isSidebarShortcut(e)) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape') {
        setOverlayOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const peek = () => {
    window.clearTimeout(leaveTimer.current)
    if (isDesktop && !showDocked) setOverlayOpen(true)
  }
  const unpeek = () => {
    if (!isDesktop) return
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => setOverlayOpen(false), 220)
  }

  return (
    <div className="flex min-h-screen">
      {showDocked && (
        <div className="sticky top-0 h-screen shrink-0 animate-[slide-in_160ms_ease-out]">
          <Sidebar variant="docked" onClose={() => dock('closed')} />
        </div>
      )}

      {!showDocked && (
        <>
          {/* Hover strip along the left edge: the peek, as in Claude. */}
          {isDesktop && (
            <div className="fixed inset-y-0 left-0 z-40 w-2" onMouseEnter={peek} aria-hidden="true" />
          )}
          {overlayOpen && !isDesktop && (
            <div
              className="animate-fade-in fixed inset-0 z-40 bg-accent-900/40 backdrop-blur-[2px]"
              onClick={() => setOverlayOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out ${
              overlayOpen ? 'translate-x-0 shadow-2xl shadow-accent-900/40' : '-translate-x-full'
            }`}
            onMouseEnter={peek}
            onMouseLeave={unpeek}
          >
            <Sidebar
              variant="overlay"
              onClose={() => setOverlayOpen(false)}
              onPin={isDesktop ? () => dock('open') : undefined}
              onNavigate={isDesktop ? undefined : () => setOverlayOpen(false)}
            />
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenPalette={() => setPaletteOpen(true)}
          sidebarHidden={!showDocked}
          onShowSidebar={() => (isDesktop ? dock('open') : setOverlayOpen(true))}
          onPeekSidebar={isDesktop ? peek : undefined}
        />
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <SignInNotice accountPath="/account" />
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
