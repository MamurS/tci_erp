import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="page">
      <h1 className="page-title">{t('common.notFound')}</h1>
      <Link to="/" className="btn btn-primary">
        {t('common.backHome')}
      </Link>
    </div>
  )
}
