/**
 * The company card's Overview tab IS the online risk report: the same
 * document as the A4 report (RiskReportBody over useRiskReport), laid out
 * for the screen, in the UI language, in the statements' own currency. On
 * screen the conclusion and rating-factor bullets drill into the tab they
 * are about (targets.ts). Above it, the actions that change what it shows.
 */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Calculator, FilePlus2, FileText, Pencil } from 'lucide-react'

import { tci } from '../../../lib/supabase'
import { Button, LinkButton } from '../../../components/ui'
import { formatAmount, formatLongDate } from '../../../lib/format'
import { EntityFormModal } from '../EntityFormModal'
import { ReportModal } from '../rating/ReportModal'
import { ReportHeader, RiskReportBody } from '../report/RiskReportDocument'
import { useRiskReport } from '../report/useRiskReport'
import type { BuyerPageTarget } from '../report/targets'
import { factorChipTarget, narrativeTarget, targetSearchParams } from '../report/targets'
import '../report/report.css'

export function OverviewTab({
  entityId,
  isPolicyholder = false,
}: {
  entityId: string
  isPolicyholder?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const [, setSearchParams] = useSearchParams()
  const [editOpen, setEditOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const report = useRiskReport({ entityId, locale, reportType: 'auto', displayCurrency: 'original' })
  const entity = report.entity
  const goTo = (target: BuyerPageTarget) => setSearchParams(targetSearchParams(target))

  if (!entity) return null

  return (
    <div className="flex flex-col gap-4">
      {isPolicyholder && <PolicyholderPortfolioLine entityId={entityId} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-3.5" />
          {t('common.edit')}
        </Button>
        {!report.hasStatements ? (
          <LinkButton variant="secondary" size="sm" to={`/entities/${entityId}/statements/new`}>
            <FilePlus2 className="size-3.5" />
            {t('fin.addStatement')}
          </LinkButton>
        ) : (
          !report.latestAssessment && (
            <Button variant="secondary" size="sm" onClick={() => goTo({ tab: 'rating' })}>
              <Calculator className="size-3.5" />
              {t('buyers.overview.calculateRating')}
            </Button>
          )
        )}
        <div className="flex-1" />
        <Button variant="accent" size="sm" onClick={() => setReportOpen(true)}>
          <FileText className="size-3.5" />
          {t('rating.generateReport')}
        </Button>
      </div>

      <div className="rpt rpt-embedded" lang={locale}>
        <article className="rpt-paper">
          <ReportHeader
            t={t}
            name={entity.name}
            registration={entity.registration_number}
            date={formatLongDate(report.today, locale)}
          />
          <RiskReportBody
            report={{ ...report, entity }}
            t={t}
            locale={locale}
            variant="screen"
            onNarrative={(key) => goTo(narrativeTarget(key))}
            onFactor={() => goTo(factorChipTarget())}
          />
        </article>
      </div>

      <EntityFormModal open={editOpen} onClose={() => setEditOpen(false)} initial={entity} />
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} entityId={entityId} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Policyholder-side portfolio summary (shown only when the entity holds
// policies): active policies + effective buyer limits under them.
// ---------------------------------------------------------------------------

function PolicyholderPortfolioLine({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data } = useQuery({
    queryKey: ['entities', entityId, 'portfolio-summary'],
    queryFn: async (): Promise<{ policies: number; limits: number; sums: string }> => {
      const { data: pols, error } = await tci()
        .from('policies')
        .select('id, status')
        .eq('entity_id', entityId)
      if (error) throw error
      const ids = (pols ?? []).map((p) => p.id as string)
      let limits = 0
      const byCcy = new Map<string, number>()
      if (ids.length) {
        const { data: lims, error: limError } = await tci()
          .from('v_effective_limits')
          .select('approved_amount, currency_code, outcome')
          .in('policy_id', ids)
        if (limError) throw limError
        for (const l of (lims ?? []) as {
          approved_amount: number | null
          currency_code: string
          outcome: string
        }[]) {
          if (l.outcome !== 'approved' && l.outcome !== 'partial') continue
          limits += 1
          byCcy.set(l.currency_code, (byCcy.get(l.currency_code) ?? 0) + Number(l.approved_amount ?? 0))
        }
      }
      const sums = [...byCcy.entries()]
        .map(([ccy, sum]) => `${formatAmount(sum, locale)} ${ccy}`)
        .join(' · ')
      return {
        policies: (pols ?? []).filter((p) => p.status === 'active').length,
        limits,
        sums,
      }
    },
  })

  if (!data) return null
  return (
    <div className="rounded-md border border-accent-500/20 bg-accent-50 px-4 py-2.5 text-[13px] text-slate-700">
      <span className="font-semibold text-accent-700">{t('entities.portfolioSummary')}</span>{' '}
      {t('dashboard.activePolicies')}: <span className="num">{data.policies}</span>
      {' · '}
      {t('entities.portfolioLimits')}: <span className="num">{data.limits}</span>
      {data.sums && (
        <>
          {' · '}
          <span className="num">{data.sums}</span>
        </>
      )}
    </div>
  )
}
