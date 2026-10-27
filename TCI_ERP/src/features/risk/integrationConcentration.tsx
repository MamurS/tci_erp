/**
 * Concentration of a policy's book or a submission's package (Prompt 31,
 * tci.cover_concentration): exposure by sector grade and by country
 * category in UZS eq., the C/D and 5–7 shares against the threshold, the
 * parties without cover, and the premium loading HINT — for information
 * only; the premium is never changed by it. Staff only (the query is not
 * enabled for a client).
 */

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { Callout, Card, COL, SectionTitle, Table } from '../../components/ui'
import { EM_DASH, formatAmount, formatPercent } from '../../lib/format'
import { useEntities } from '../entities/api'
import { ShareBar } from '../portfolio/parts'
import { useCountryRisk, useCoverConcentration, useIsStaffReader, useRiskSettings } from './api'
import { CONCENTRATION_ROLES, concentrationReasons, concentrationView } from './integration'
import type { ConcentrationRow } from './integration'

function RowsTable({
  head,
  rows,
  label,
}: {
  head: string
  rows: ConcentrationRow[]
  label: (key: string) => string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  return (
    <Table dense columns={[COL.fill, COL.count, COL.amount, COL.share]}>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="num">{t('risk.concentration.buyers')}</th>
          <th className="num">{t('risk.concentration.amountUzs')}</th>
          <th className="num">{t('risk.concentration.share')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{label(r.key)}</td>
            <td className="num">{formatAmount(r.buyers, locale, 0)}</td>
            <td className="num">{formatAmount(r.amountUzs, locale, 0)}</td>
            <td className="num">
              <ShareBar share={r.share} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export function ConcentrationPanel({ scope, id }: { scope: 'policy' | 'submission'; id: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole } = useAuth()
  const staff = useIsStaffReader() && CONCENTRATION_ROLES.some((r) => r === actingRole)
  const query = useCoverConcentration(scope, id)
  const countries = useCountryRisk()
  const settings = useRiskSettings()
  const { data: entities } = useEntities()
  if (!staff) return null

  const title = t('risk.concentration.title')
  const hint = t(scope === 'policy' ? 'risk.concentration.hintPolicy' : 'risk.concentration.hintSubmission')

  if (query.isLoading) {
    return (
      <Card className="p-5">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <p className="mt-3 text-small text-slate-500">{t('common.loading')}</p>
      </Card>
    )
  }
  if (query.isError || !query.data) {
    return (
      <Card className="p-5">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <p className="mt-3 text-small text-slate-500">{t('risk.concentration.unavailable')}</p>
      </Card>
    )
  }

  const v = concentrationView(query.data, {
    oecdImported: Boolean(countries.data?.some((c) => c.latest_import_effective)),
    adjustments: settings.data?.adjustments ?? null,
  })
  const nameOf = new Map((entities ?? []).map((e) => [e.id, e.name]))

  if (v.buyers === 0) {
    return (
      <Card className="p-5">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <p className="mt-3 text-small text-slate-500">
          {t(scope === 'policy' ? 'risk.concentration.emptyPolicy' : 'risk.concentration.emptySubmission')}
        </p>
      </Card>
    )
  }

  const reasons = concentrationReasons(v)
  const pct = (fraction: number | null) => formatPercent(fraction, locale)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={hint}>{title}</SectionTitle>

      {query.data.blocked.length > 0 && (
        <Callout tone="neg" title={t('risk.concentration.blockedTitle')}>
          <ul className="list-inside list-disc">
            {query.data.blocked.map((b) => (
              <li key={b.entity_id}>
                <Link to={`/entities/${b.entity_id}`} className="text-accent-700 hover:underline">
                  {nameOf.get(b.entity_id) ?? EM_DASH}
                </Link>{' '}
                — {t(b.block === 'company' ? 'risk.concentration.blockedCompany' : 'risk.concentration.blockedCountry')}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {v.warn && (
        <Callout tone="warn" title={t('risk.concentration.warnTitle', { pct: pct(v.warnAt) })}>
          <ul className="list-inside list-disc">
            {reasons.map((r) => (
              <li key={r}>
                {r === 'share_cd'
                  ? t('risk.concentration.reasons.shareCd', { share: pct(v.shareCd), pct: pct(v.warnAt) })
                  : r === 'share_cat57'
                    ? t('risk.concentration.reasons.shareCat57', { share: pct(v.shareCat57), pct: pct(v.warnAt) })
                    : t('risk.concentration.reasons.singleCdSector')}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <dl className="grid grid-cols-2 gap-3 text-small sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">{t('risk.concentration.total')}</dt>
          <dd className="num font-semibold text-slate-900">{formatAmount(v.totalUzs, locale, 0)} UZS</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t('risk.concentration.shareCd')}</dt>
          <dd className="num font-semibold text-slate-900">{pct(v.shareCd)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t('risk.concentration.shareCat57')}</dt>
          <dd className="num font-semibold text-slate-900">{v.byCountry ? pct(v.shareCat57) : EM_DASH}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t('risk.concentration.threshold')}</dt>
          <dd className="num font-semibold text-slate-900">{pct(v.warnAt)}</dd>
        </div>
      </dl>

      {v.ratesMissing > 0 && (
        <p className="text-small text-warning-700">{t('risk.concentration.ratesMissing', { count: v.ratesMissing })}</p>
      )}

      <RowsTable
        head={t('risk.concentration.bySector')}
        rows={v.bySector}
        label={(key) => (key === 'none' ? t('risk.concentration.sectorNone') : t('risk.concentration.sectorKey', { grade: key }))}
      />
      {v.byCountry ? (
        <RowsTable
          head={t('risk.concentration.byCountry')}
          rows={v.byCountry}
          label={(key) =>
            key === 'unclassified'
              ? t('risk.concentration.countryUnclassified')
              : t('risk.concentration.countryKey', { category: key })
          }
        />
      ) : (
        <p className="text-small text-slate-500">{t('risk.concentration.countryInactive')}</p>
      )}

      <p className="text-small text-slate-600">
        <span className="font-medium text-slate-700">{t('risk.concentration.loading')}: </span>
        <span className="num">{v.loadingHintPct === null ? EM_DASH : formatPercent(v.loadingHintPct / 100, locale)}</span>{' '}
        <span className="text-slate-500">— {t('risk.concentration.loadingNote')}</span>
      </p>
    </Card>
  )
}
