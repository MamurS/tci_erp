import { useTranslation } from 'react-i18next'

interface StubPageProps {
  /** i18n key of the section title, e.g. "nav.buyers" */
  titleKey: string
}

/** Placeholder page for sections that will be implemented in later phases. */
export function StubPage({ titleKey }: StubPageProps) {
  const { t } = useTranslation()
  return (
    <div className="page">
      <h1 className="page-title">{t(titleKey)}</h1>
      <div className="stub-card">
        <p className="stub-title">{t('common.comingSoon')}</p>
        <p className="stub-hint">{t('common.comingSoonHint')}</p>
      </div>
    </div>
  )
}
