import { useTranslation } from 'react-i18next'

import { useCountries } from '../entities/api'

/** Country names in the UI language (falls back to English, then the code). */
export function useCountryName(): (code: string | null) => string {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'en'
  const { data: countries } = useCountries()
  return (code) => {
    if (!code) return '—'
    const row = (countries ?? []).find((c) => c.code === code)
    if (!row) return code
    return (lang === 'ru' ? row.name_ru : lang === 'uz' ? row.name_uz : row.name_en) || row.name_en || code
  }
}
