import { useTranslation } from 'react-i18next'
import { Segmented } from '../ui'
import { SUPPORTED_LANGUAGES } from '../../i18n'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  return (
    <Segmented
      ariaLabel={t('common.language')}
      value={i18n.resolvedLanguage ?? 'ru'}
      options={SUPPORTED_LANGUAGES.map((lng) => ({ key: lng, label: lng.toUpperCase() }))}
      onChange={(lng) => void i18n.changeLanguage(lng)}
    />
  )
}
