import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { CommandPalette } from './CommandPalette'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { SidebarToggle } from './SidebarToggle'
import { isPaletteShortcut } from './commandPalette'
import { PEEK_CLOSE_MS, PEEK_OPEN_MS, SIDEBAR_KEY, isSidebarShortcut, parseSidebarState } from './shell'
import type { SidebarState } from './shell'
import { PageLoading } from './PageLoading'
import { SignInNotice } from '../../auth/SignInNotice'
import { useAuth } from '../../auth/AuthContext'
import { availableWorkspaces, rememberWorkspace, workspaceForRole, workspaceHome } from './workspaces'
import type { WorkspaceKey } from './workspaces'

const DESKTOP = '(min-width: 1024px)'

function readSidebar(): SidebarState {
  try {
    return parseSidebarState(window.localStorage.getItem(SIDEBAR_KEY))
  } catch {
    return 'open'
  }
}

/**
 * The role workspace on screen IS the acting role's (0063): opening a page
 * never switches it. Switching acts in the chosen workspace's role (the
 * server is told, every query refetched) and lands on its first tool.
 */
function useWorkspace() {
  const { heldRoles, actingRole, switchActingRole } = useAuth()
  const navigate = useNavigate()
  const workspace = workspaceForRole(actingRole)?.key ?? null

  const switchTo = useCallback(
    (key: WorkspaceKey) => {
      const target = availableWorkspaces(heldRoles).find((w) => w.key === key)
      if (!target) return
      rememberWorkspace(key)
      navigate(workspaceHome([target.role], target))
      switchActingRole(target.role).catch((error: unknown) => {
        console.error('Failed to switch the acting role', error)
      })
    },
    [heldRoles, navigate, switchActingRole],
  )

  return { workspace, switchTo }
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

/** id of the navigation panel, for the toggle's aria-controls. */
const SIDEBAR_ID = 'app-sidebar'

/**
 * The staff frame, with the sidebar of the Claude app. On a desktop the panel
 * is pinned or hidden (remembered per browser), and its toggle is ONE button
 * in a fixed layer above everything, 20px in and centred in the 64px top row,
 * in every state — it never moves and never changes size; only its colours
 * follow what is behind it (navy panel or white top bar).
 *
 * Hidden, resting the pointer on the toggle or on the 8px strip at the left
 * window edge for PEEK_OPEN_MS shows the whole panel over the content (the
 * page does not move); it goes away PEEK_CLOSE_MS after the pointer has left
 * both, on Esc, and on a click outside. Clicking the toggle while peeking pins
 * the panel where it is. Nothing is animated: pin, unpin and peek are instant.
 * Below 1024px the panel is a drawer. Ctrl/⌘ B toggles it, Ctrl/⌘ K opens the
 * command palette.
 */
export function AppShell() {
  const isDesktop = useIsDesktop()
  const [docked, setDocked] = useState<SidebarState>(readSidebar)
  const [peeking, setPeeking] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const peekRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const { workspace, switchTo } = useWorkspace()
  const workspaceProps = { workspace, onSwitchWorkspace: switchTo }

  const pinned = isDesktop && docked === 'open'
  const collapsed = isDesktop && docked === 'closed'
  const showPeek = collapsed && peeking

  const clearTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }

  const dock = useCallback((next: SidebarState) => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    setDocked(next)
    setPeeking(false)
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next)
    } catch {
      // a per-browser convenience; nothing to do when storage is blocked
    }
  }, [])

  const toggle = useCallback(() => {
    if (isDesktop) dock(docked === 'open' ? 'closed' : 'open')
    else setDrawerOpen((v) => !v)
  }, [isDesktop, docked, dock])

  // Hover intent: open after a short rest, so passing over the corner does
  // not flash the panel; close a little after the pointer has left.
  const schedulePeek = () => {
    if (!collapsed) return
    window.clearTimeout(closeTimer.current)
    if (peeking) return
    window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => setPeeking(true), PEEK_OPEN_MS)
  }
  const scheduleUnpeek = () => {
    clearTimers()
    closeTimer.current = window.setTimeout(() => setPeeking(false), PEEK_CLOSE_MS)
  }

  useEffect(() => () => clearTimers(), [])

  // A peek or a drawer never outlives the page it was opened on.
  useEffect(() => {
    setPeeking(false)
    setDrawerOpen(false)
  }, [pathname])

  // A click anywhere but the panel and its toggle puts the peek away.
  useEffect(() => {
    if (!showPeek) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (peekRef.current?.contains(target) || toggleRef.current?.contains(target)) return
      setPeeking(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showPeek])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (isSidebarShortcut(e)) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape') {
        setPeeking(false)
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <div className="flex min-h-screen">
      {isDesktop && (
        // The one toggle. It comes BEFORE the panel in the document, so Tab
        // goes from it straight into the menu while the panel is shown.
        <div
          ref={toggleRef}
          className="fixed top-3.5 left-5 z-[60]"
          onMouseEnter={schedulePeek}
          onMouseLeave={collapsed ? scheduleUnpeek : undefined}
        >
          <SidebarToggle
            action={pinned ? 'hide' : 'show'}
            tone={pinned || showPeek ? 'inverse' : 'plain'}
            expanded={pinned || showPeek}
            controls={SIDEBAR_ID}
            onClick={() => dock(pinned ? 'closed' : 'open')}
          />
        </div>
      )}

      {pinned && (
        <div className="sticky top-0 z-40 h-screen shrink-0">
          <Sidebar id={SIDEBAR_ID} variant="docked" {...workspaceProps} />
        </div>
      )}

      {collapsed && !showPeek && (
        // The hot strip along the left window edge.
        <div aria-hidden className="fixed inset-y-0 left-0 z-[45] w-2" onMouseEnter={schedulePeek} onMouseLeave={scheduleUnpeek} />
      )}

      {showPeek && (
        // The same panel as pinned, flush with the left edge and over the
        // top bar and the content, which do not move.
        <div
          ref={peekRef}
          className="fixed inset-y-0 left-0 z-50 shadow-2xl shadow-accent-900/40"
          onMouseEnter={schedulePeek}
          onMouseLeave={scheduleUnpeek}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null
            if (next && !peekRef.current?.contains(next) && !toggleRef.current?.contains(next)) setPeeking(false)
          }}
        >
          <Sidebar id={SIDEBAR_ID} variant="peek" {...workspaceProps} />
        </div>
      )}

      {!isDesktop && drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-accent-900/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 shadow-2xl shadow-accent-900/40">
            <Sidebar
              id={SIDEBAR_ID}
              variant="drawer"
              onToggle={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
              {...workspaceProps}
            />
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenPalette={() => setPaletteOpen(true)}
          toggleSlot={pinned ? 'none' : isDesktop ? 'spacer' : 'button'}
          onShowSidebar={() => setDrawerOpen(true)}
          sidebarId={SIDEBAR_ID}
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
