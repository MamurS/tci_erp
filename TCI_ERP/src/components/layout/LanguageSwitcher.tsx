import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../i18n'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-slate-200"
      role="group"
      aria-label={t('common.language')}
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => void i18n.changeLanguage(lng)}
          className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
            lng === current
              ? 'bg-accent-600 text-white'
              : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          }`}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
