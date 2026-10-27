/**
 * «Кредитный анализ › Сектора» (Prompt 31, migration 0085): the sector grades
 * — every industry's grade, outlook and review state with the book in it —
 * and the country risk table (OECD category, the internal one, sanctions),
 * as two views of one section (?view=). Credit analysts work them; credit
 * underwriting and admin read them (admin also names each sector's
 * responsible analyst).
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SectionPage } from '../../components/ui'
import { useCountryOverrides, useSectorGrades } from '../risk/api'
import { SECTOR_VIEWS, parseSectorView } from './model'
import type { SectorView } from './model'

const SectorListView = lazy(() => import('./SectorListView').then((m) => ({ default: m.SectorListView })))
const CountryRiskView = lazy(() => import('./CountryRiskView').then((m) => ({ default: m.CountryRiskView })))

export function SectorsSection() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view = parseSectorView(params.get('view'))

  // The counts on the tabs: what waits for someone (React Query shares them
  // with the views).
  const sectors = useSectorGrades()
  const overrides = useCountryOverrides()
  const counts: Record<SectorView, number | null> = {
    sectors: sectors.data ? sectors.data.filter((s) => s.pending || s.overdue).length || null : null,
    countries: overrides.data ? overrides.data.filter((o) => o.status === 'pending').length || null : null,
  }

  return (
    <SectionPage
      title={t('nav.sectors')}
      subtitle={t('risk.sectors.subtitle')}
      tabs={SECTOR_VIEWS.map((key) => ({ key, label: t(`risk.sectors.views.${key}`), count: counts[key] }))}
      active={view}
      // A view switch keeps nothing of the other view's filters.
      onChange={(next) => setParams({ view: next }, { replace: true })}
    >
      {view === 'sectors' && <SectorListView />}
      {view === 'countries' && <CountryRiskView />}
    </SectionPage>
  )
}
