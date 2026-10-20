import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

/**
 * A `t` bound to a language other than the UI's (the printed report is
 * produced in the language picked for it). en / uz are loaded on demand,
 * so `ready` is false until that language's bundle has arrived.
 */
export function useFixedT(language: string): { t: TFunction; ready: boolean } {
  const { i18n } = useTranslation()
  const [loaded, setLoaded] = useState<string | null>(() =>
    i18n.hasResourceBundle(language, 'translation') ? language : null,
  )

  useEffect(() => {
    if (i18n.hasResourceBundle(language, 'translation')) {
      setLoaded(language)
      return
    }
    let alive = true
    void i18n.loadLanguages(language).then(() => {
      if (alive) setLoaded(language)
    })
    return () => {
      alive = false
    }
  }, [i18n, language])

  // getFixedT reads the store at call time; the setLoaded re-render is what
  // makes the freshly loaded strings appear.
  const t = useMemo(() => i18n.getFixedT(language), [i18n, language])
  return { t, ready: loaded === language }
}
