/**
 * The sidebar toggle, as in the Claude app: an icon button whose label shows
 * as a dark tooltip with the shortcut, not as a native title. The same button
 * sits in the top-left corner while the panel is hidden and in the peek card
 * that slides out from under the pointer, so resting on it never moves it.
 */

import type { MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'

interface SidebarToggleProps {
  /** show: brings the panel back (hidden, peek); hide: puts it away (docked, drawer). */
  action: 'show' | 'hide'
  onClick: () => void
  onMouseEnter?: MouseEventHandler
  onMouseLeave?: MouseEventHandler
  /** inverse: on the navy panel; plain: on the white top bar. */
  tone: 'inverse' | 'plain'
}

export function SidebarToggle({ action, onClick, onMouseEnter, onMouseLeave, tone }: SidebarToggleProps) {
  const { t } = useTranslation()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const label = t(action === 'show' ? 'nav.show' : 'nav.hide')
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={label}
      className={`group relative flex size-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        tone === 'inverse'
          ? 'text-white/65 hover:bg-white/10 hover:text-white'
          : 'text-slate-500 hover:bg-slate-100 hover:text-accent-600'
      }`}
    >
      <PanelLeft className="size-5" strokeWidth={1.8} />
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-10 mt-1.5 flex items-center gap-2 rounded-md bg-slate-900 px-2 py-1 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity delay-0 group-hover:opacity-100 group-hover:delay-500"
      >
        {label}
        <span className="text-white/55">{isMac ? '⌘B' : 'Ctrl+B'}</span>
      </span>
    </button>
  )
}
