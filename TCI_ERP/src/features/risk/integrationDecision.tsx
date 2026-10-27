/**
 * The buyer's sector, country and sanctions on a decision screen (Prompt 31,
 * tci.buyer_risk_context): the facts with their badges, the non-blocking
 * warnings (amber) and the hard stop when cover is not available (red). The
 * database refuses a sanctioned approval whatever the screen says; these
 * mirror it so the decider sees why before anything is sent.
 */

import { useTranslation } from 'react-i18next'

import { Callout, CountryFlag } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { levelName } from '../limits/levelName'
import { useSectorByIndustry } from './api'
import { CountryCategoryBadge, SanctionsBadge, SectorBadge } from './badges'
import { countryRiskActive, visibleWarnings, warningKey } from './integration'
import { useDecisionRisk } from './integrationHooks'
import { COMMITTEE_RANK } from './rules'
import type { BuyerRiskContext } from './rules'

/** Sector and country as two lines of a fact card: the industry with its
 * sector grade and outlook, the country with its category and any flag. */
export function BuyerRiskFacts({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const { ctx, oecdImported } = useDecisionRisk(entityId)
  const sectors = useSectorByIndustry()
  if (!ctx) return null
  const lang = (i18n.resolvedLanguage ?? 'ru').slice(0, 2) as 'en' | 'ru' | 'uz'
  const sector = ctx.industry_code ? sectors.get(ctx.industry_code) : undefined
  const industryName = sector ? (sector[`name_${lang}`] ?? sector.name_en) : null
  const countryActive = countryRiskActive(ctx, oecdImported)
  const companyFlag = ctx.sanctions.some((s) => s.scope === 'entity')
  const countryFlag = ctx.sanctions.some((s) => s.scope === 'country')
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-small">
      <dt className="text-slate-500">{t('risk.decision.sector')}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {industryName && <span className="min-w-0 text-slate-700">{industryName}</span>}
        {ctx.sector_grade ? (
          <SectorBadge
            grade={ctx.sector_grade}
            outlook={ctx.sector_outlook}
            stale={ctx.sector_stale}
            reviewedAt={ctx.sector_reviewed_at}
            industryName={industryName}
          />
        ) : (
          <span className="text-slate-500">{t('risk.decision.sectorNotGraded')}</span>
        )}
        {ctx.sector_outlook && (
          <span className="text-caption text-slate-500">{t(`risk.outlook.${ctx.sector_outlook}`)}</span>
        )}
      </dd>
      <dt className="text-slate-500">{t('risk.decision.country')}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {ctx.country_code && (
          <span className="inline-flex items-center text-slate-700">
            <CountryFlag code={ctx.country_code} className="mr-2" />
            {ctx.country_code}
          </span>
        )}
        {countryActive ? (
          <CountryCategoryBadge
            category={ctx.country_category}
            source={ctx.country_source}
            oecdCategory={ctx.oecd_category}
          />
        ) : (
          <span className="text-caption text-slate-500">{t('risk.decision.countryInactive')}</span>
        )}
        {countryFlag && <SanctionsBadge />}
      </dd>
      {companyFlag && (
        <>
          <dt className="text-slate-500">{t('risk.decision.company')}</dt>
          <dd>
            <SanctionsBadge />
          </dd>
        </>
      )}
    </dl>
  )
}

/** One sanctions flag in words: the party, the regime, the source, since when. */
function SanctionLine({ s }: { s: BuyerRiskContext['sanctions'][number] }) {
  const { t, i18n } = useTranslation()
  return (
    <li>
      {t('risk.decision.sanctionLine', {
        party: t(`risk.decision.scope.${s.scope}`),
        regime: t(`risk.decision.regimes.${s.regime}`),
        source: s.source,
        date: formatDate(s.effective_from, i18n.resolvedLanguage ?? 'en'),
      })}
      {s.reference && <span className="text-slate-500"> · {s.reference}</span>}
    </li>
  )
}

/**
 * Above a decision: the hard stop (red) when the company or its country is
 * under sanctions, and the warnings (amber). `showRank` gives the credit
 * decider the cover matrix's rank warning — nobody else's rank is asked.
 */
export function BuyerRiskNotices({
  entityId,
  showRank,
  showWarnings = true,
}: {
  entityId: string
  showRank: boolean
  /** The warnings speak to a decision still to take; a closed request
   * keeps only the hard stop. */
  showWarnings?: boolean
}) {
  const { t } = useTranslation()
  const { ctx, oecdImported } = useDecisionRisk(entityId)
  if (!ctx) return null
  const warnings = showWarnings ? visibleWarnings(ctx, oecdImported, { showRank }) : []
  const rankName = (rank: number) =>
    rank <= 0 ? t('risk.decision.noLevel') : levelName(t, 'credit', rank, rank >= COMMITTEE_RANK)
  return (
    <>
      {ctx.cover_block && (
        <Callout tone="neg" title={t('risk.decision.blockTitle')}>
          <p>{t(ctx.cover_block === 'company' ? 'risk.errors.coverCompany' : 'risk.errors.coverCountry')}</p>
          {ctx.sanctions.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {ctx.sanctions.map((s, i) => (
                <SanctionLine key={`${s.scope}-${s.regime}-${i}`} s={s} />
              ))}
            </ul>
          )}
          <p className="mt-1">{t('risk.decision.blockDeclineStill')}</p>
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warn" title={t('risk.decision.warningsTitle')}>
          <ul className="list-inside list-disc">
            {warnings.map((w) => {
              const { key, params } = warningKey(w)
              return (
                <li key={w.kind}>
                  {w.kind === 'rank'
                    ? t(key, { required: rankName(w.required), mine: rankName(w.mine) })
                    : t(key, params)}
                </li>
              )
            })}
          </ul>
        </Callout>
      )}
    </>
  )
}
