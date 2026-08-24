import { useTranslation } from 'react-i18next'
import { EmptyState } from './primitives'
import { PageHeader } from './primitives'

interface StubPageProps {
  /** i18n key of the section title, e.g. "nav.buyers" */
  titleKey: string
}

/** Placeholder page for sections that will be implemented in later phases. */
export function StubPage({ titleKey }: StubPageProps) {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <EmptyState title={t('common.comingSoon')} hint={t('common.comingSoonHint')} />
    </div>
  )
}
