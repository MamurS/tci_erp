/**
 * The sidebar toggle, as in the Claude app: an icon button whose label shows
 * as a dark tooltip with the shortcut, not as a native title. On a desktop
 * there is exactly ONE of it, in a fixed layer above the panel (AppShell), so
 * it keeps the same screen position and size whether the panel is pinned,
 * hidden or peeking; only its colours follow what is behind it.
 */

import type { MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'

interface SidebarToggleProps {
  /** show: brings the panel back (hidden, peek); hide: puts it away (pinned, drawer). */
  action: 'show' | 'hide'
  onClick: () => void
  onMouseEnter?: MouseEventHandler
  onMouseLeave?: MouseEventHandler
  /** inverse: on the navy panel; plain: on the white top bar. */
  tone: 'inverse' | 'plain'
  /** Whether the panel is on screen (pinned or peeking) — aria-expanded. */
  expanded: boolean
  /** id of the panel it controls — aria-controls. */
  controls: string
}

export function SidebarToggle({ action, onClick, onMouseEnter, onMouseLeave, tone, expanded, controls }: SidebarToggleProps) {
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
      aria-expanded={expanded}
      aria-controls={controls}
      className={`group relative flex size-9 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none ${
        tone === 'inverse'
          ? 'text-white/65 hover:bg-white/10 hover:text-white focus-visible:ring-white/60'
          : 'text-slate-500 hover:bg-slate-100 hover:text-accent-600 focus-visible:ring-accent-400'
      }`}
    >
      <PanelLeft className="size-5" strokeWidth={1.8} />
      {/* Below and to the right of the button's left edge: the name sits on
          the same row to its right, so the tooltip never covers it. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-10 mt-2 flex items-center gap-2 rounded-md bg-slate-900 px-2 py-1 text-caption font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity delay-0 group-hover:opacity-100 group-hover:delay-500 group-focus-visible:opacity-100"
      >
        {label}
        <span className="text-white/70">{isMac ? '⌘B' : 'Ctrl+B'}</span>
      </span>
    </button>
  )
}
