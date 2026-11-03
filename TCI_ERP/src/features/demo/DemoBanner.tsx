/** While a person is in the demo world (0096): a slim bar above every page of
 * the shell, and a «DEMO» mark in the top bar. Both are there for the whole
 * session in demo mode, so nothing moves while the person works. */

import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'

import { useDemoState, useSetDemoMode } from './api'
import { inDemoWorld, mayToggleDemo } from './model'

export function DemoBanner() {
  const { t } = useTranslation()
  const { data: state } = useDemoState()
  const save = useSetDemoMode()
  const shown = inDemoWorld(state)
  const ref = useRef<HTMLDivElement>(null)
  // Dialogs are centred BELOW the bar (Modal reads --demo-banner-bottom):
  // where its bottom edge is on screen now — under the portal's header, or
  // nothing once the page has scrolled it away — kept up to date.
  useLayoutEffect(() => {
    const el = ref.current
    if (!shown || !el) return
    const root = document.documentElement
    let frame = 0
    const write = () =>
      root.style.setProperty('--demo-banner-bottom', `${Math.max(0, el.getBoundingClientRect().bottom)}px`)
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(write)
    }
    write()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      root.style.removeProperty('--demo-banner-bottom')
    }
  }, [shown])
  if (!shown) return null
  return (
    <div
      ref={ref}
      role="status"
      data-testid="demo-banner"
      className="flex min-h-9 items-center justify-center gap-3 border-b border-warning-300 bg-warning-100 px-4 py-2 text-small text-slate-900"
    >
      <FlaskConical className="size-4 shrink-0 text-warning-700" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold">{t('demo.banner.title')}</span>{' '}
        <span className="text-slate-700">{t('demo.banner.body')}</span>
      </span>
      {mayToggleDemo(state) && (
        <button
          type="button"
          onClick={() => save.mutate(false)}
          disabled={save.isPending}
          className="shrink-0 rounded-md border border-warning-700/40 bg-white px-3 py-0.5 text-small font-semibold text-slate-900 hover:bg-warning-50 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none disabled:opacity-60"
        >
          {t('demo.banner.leave')}
        </button>
      )}
    </div>
  )
}

/** The top bar's mark: says «DEMO» next to the section name. */
export function DemoMark() {
  const { t } = useTranslation()
  const { data: state } = useDemoState()
  if (!inDemoWorld(state)) return null
  return (
    <span
      data-testid="demo-mark"
      title={t('demo.banner.title')}
      className="inline-flex h-text-6 shrink-0 items-center rounded-md bg-warning-700 px-2 text-caption font-semibold tracking-wide text-white"
    >
      {t('demo.mark')}
    </span>
  )
}
