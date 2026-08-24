import { useTranslation } from 'react-i18next'
import { Spinner } from './primitives'

export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner label={t('common.loading')} />
    </div>
  )
}
