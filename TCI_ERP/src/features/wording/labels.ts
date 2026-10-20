/** Labels for the context builder in a TEMPLATE's language: enum labels
 *  through a fixed-language t (en/ru/uz, others fall back to en) and country
 *  names from the reference table. */

import { useMemo } from 'react'

import { useFixedT } from '../../i18n/useFixedT'
import { useCountries } from '../entities/api'
import type { ContextLabels } from './context'
import { wordingLocale } from './context'

export function useWordingLabels(language: string, source: 'policy' | 'submission') {
  const lang = wordingLocale(language)
  const { t, ready } = useFixedT(lang)
  const { data: countries } = useCountries()

  const labels = useMemo<ContextLabels>(
    () => ({
      enumLabel: (kind, value) => {
        if (kind === 'product') return t(`policies.structures.${value}`)
        if (kind === 'frequency') return t(`policies.frequencies.${value}`)
        if (kind === 'premium_basis') return t(`premium.basis.${value}`)
        return source === 'policy' ? t(`policies.statuses.${value}`) : t(`requests.statuses.${value}`)
      },
      countryName: (code) => {
        const row = countries?.find((c) => c.code === code)
        if (!row) return code
        return lang === 'ru' ? row.name_ru : lang === 'uz' ? row.name_uz : row.name_en
      },
    }),
    [t, countries, lang, source],
  )
  return { labels, ready: ready && Boolean(countries) }
}

/** A language's name in the UI language ("русский", "Russian"), or its code. */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Languages a wording template may be written in: the app's three, the
 *  region's, and the main international ones. */
export const TEMPLATE_LANGUAGES = [
  'ru', 'uz', 'en', 'kk', 'ky', 'tg', 'tk', 'az', 'hy', 'ka', 'mn', 'ne', 'uk', 'be',
  'zh', 'ja', 'ko', 'hi', 'tr', 'ar', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'vi',
] as const
