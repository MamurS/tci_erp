import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { CommandPalette } from './CommandPalette'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { isPaletteShortcut } from './commandPalette'

const COLLAPSE_KEY = 'tci-erp-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // a per-browser convenience; nothing to do when storage is blocked
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenPalette={() => setPaletteOpen(true)} />
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-6 py-7 lg:px-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
