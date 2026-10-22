/**
 * «Брошюра TCI» — the product brochure that goes out with every commercial
 * offer, and the library of images it may use. Admin and sales (0058: the
 * writer functions and the upload policy refuse everyone else).
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SectionPage } from '../../components/ui'
import { useMediaAssets } from './api'
import { BROCHURE_VIEWS, parseBrochureView } from './views'

const BrochureView = lazy(() => import('./BrochureView').then((m) => ({ default: m.BrochureView })))
const MediaLibraryView = lazy(() =>
  import('./MediaLibraryView').then((m) => ({ default: m.MediaLibraryView })),
)

export function BrochurePage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view = parseBrochureView(params.get('view'))
  const media = useMediaAssets()
  const activeImages = media.data?.filter((a) => !a.retired_at).length

  return (
    <SectionPage
      title={t('nav.brochure')}
      subtitle={t('brochure.sectionSubtitle')}
      tabs={BROCHURE_VIEWS.map((key) => ({
        key,
        label: t(`brochure.views.${key}`),
        ...(key === 'media' ? { count: activeImages || null } : {}),
      }))}
      active={view}
      onChange={(next) => setParams({ view: next }, { replace: true })}
    >
      {view === 'brochure' && <BrochureView />}
      {view === 'media' && <MediaLibraryView />}
    </SectionPage>
  )
}
