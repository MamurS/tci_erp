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
 * The staff frame, with Claude's sidebar behaviour. On a desktop the sidebar
 * is docked or hidden (remembered per browser). Hidden, resting the pointer
 * on the toggle in the top-left corner floats it out as a card BELOW that
 * toggle, so the toggle stays reachable and a click docks the panel again;
 * leaving both the toggle and the card puts it away. Nothing else peeks it —
 * no edge strip, no pin. Below 1024px it is a drawer. Ctrl/⌘ B toggles it,
 * Ctrl/⌘ K opens the command palette.
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

      {!showDocked && isDesktop && (
        // The peek: a floating card under the header toggle. It starts below
        // the toggle so it never covers it, and is inert while put away.
        <div
          className={`fixed top-[58px] bottom-2 left-2 z-50 overflow-hidden rounded-xl shadow-2xl shadow-accent-900/40 transition-[opacity,transform] duration-150 ease-out ${
            overlayOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-2 opacity-0'
          }`}
          onMouseEnter={peek}
          onMouseLeave={unpeek}
          inert={!overlayOpen}
        >
          <Sidebar variant="peek" onClose={() => setOverlayOpen(false)} />
        </div>
      )}

      {!showDocked && !isDesktop && (
        <>
          {overlayOpen && (
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
            inert={!overlayOpen}
          >
            <Sidebar
              variant="drawer"
              onClose={() => setOverlayOpen(false)}
              onNavigate={() => setOverlayOpen(false)}
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
          onUnpeekSidebar={isDesktop ? unpeek : undefined}
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
