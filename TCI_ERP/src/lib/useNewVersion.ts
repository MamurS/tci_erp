import { useEffect, useRef, useState } from 'react'

import { VERSION_MIN_GAP_MS, VERSION_POLL_MS, newerBuildIsServed } from './appVersion'

/**
 * True once the server serves a newer build than this tab runs. Asks on
 * mount, when the tab comes back to the front, and every few minutes; stops
 * asking once the answer is yes (it does not become "no" again).
 */
export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false)
  const lastAsked = useRef(0)
  // Whether the component is mounted when an answer arrives. Not a per-run
  // flag: the asks are throttled, so an answer to an ask made before a
  // re-run of this effect is the only answer for a while and must count.
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (stale) return
    const ask = () => {
      const now = Date.now()
      if (now - lastAsked.current < VERSION_MIN_GAP_MS) return
      lastAsked.current = now
      void newerBuildIsServed().then((yes) => {
        if (yes && mounted.current) setStale(true)
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask()
    }
    ask()
    const timer = window.setInterval(ask, VERSION_POLL_MS)
    window.addEventListener('focus', ask)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', ask)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [stale])

  return stale
}
