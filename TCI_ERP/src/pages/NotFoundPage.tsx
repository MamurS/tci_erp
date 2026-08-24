import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/ui'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <EmptyState
      title={t('common.notFound')}
      action={
        <Link to="/" className="text-sm font-medium text-accent-700 hover:underline">
          {t('common.backHome')}
        </Link>
      }
    />
  )
}
