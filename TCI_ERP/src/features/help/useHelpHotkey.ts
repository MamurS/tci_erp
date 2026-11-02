import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { helpBase, helpHrefFor } from './pages'

export function isHelpPath(pathname: string): boolean {
  return /^(\/portal)?\/help(\/|$)/.test(pathname)
}

/** Where help for the current page lives (the Help home on the Help pages themselves). */
export function useHelpHref(): string {
  const { pathname } = useLocation()
  const { actingRole } = useAuth()
  if (isHelpPath(pathname)) return helpBase(actingRole === 'client')
  return helpHrefFor(pathname, actingRole)
}

/** F1 anywhere in the shell: help for the page you are on. */
export function useHelpHotkey(): void {
  const navigate = useNavigate()
  const href = useHelpHref()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.altKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      navigate(href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, href])
}
