import { useTranslation } from 'react-i18next'

export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="loading-screen" role="status">
      {t('common.loading')}
    </div>
  )
}
