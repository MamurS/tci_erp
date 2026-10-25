/** The claims queue. Ageing, status and amounts, with the files that need
 * attention first: an assessment already running, then a fresh filing, then
 * everything settled or refused. */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  COL,
  EmptyState,
  labelCol,
  PageHeader,
  Segmented,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { useClaims } from './api'
import { isOpen } from './machine'
import { CLAIM_STATUS_TONE as STATUS_TONE } from './status'
import type { Claim, ClaimStatus } from './types'

/** Assessment order: a file waiting on us outranks one waiting on them. */
const QUEUE_RANK: Record<ClaimStatus, number> = {
  submitted: 0,
  under_assessment: 1,
  approved: 2,
  partially_approved: 2,
  info_requested: 3,
  draft: 4,
  paid: 5,
  declined: 6,
  withdrawn: 7,
  closed: 8,
}

export function ClaimsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data, isLoading } = useClaims()
  const [scope, setScope] = useState<'open' | 'all'>('open')

  const rows = useMemo(() => {
    const all = data ?? []
    const filtered = scope === 'open' ? all.filter((c) => isOpen(c.status)) : all
    return [...filtered].sort(
      (a, b) =>
        QUEUE_RANK[a.status] - QUEUE_RANK[b.status] ||
        (b.assessment_age_days ?? -1) - (a.assessment_age_days ?? -1),
    )
  }, [data, scope])

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('claims.title')}
        subtitle={t('claims.subtitle')}
        actions={
          <Segmented
            ariaLabel={t('claims.scope.label')}
            value={scope}
            onChange={(v) => setScope(v as 'open' | 'all')}
            options={[
              { key: 'open', label: t('claims.scope.open') },
              { key: 'all', label: t('claims.scope.all') },
            ]}
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={scope === 'open' ? t('claims.empty.openTitle') : t('claims.empty.allTitle')}
          hint={t('claims.empty.hint')}
        />
      ) : (
        <Table columns={[COL.code, COL.fill, COL.money, COL.money, '7rem', labelCol('claimStatus')]}>
          <thead>
            <tr>
              {/* w-px: the other columns take their content's width, and the
                  names column everything left over. */}
              <th>{t('claims.fields.number')}</th>
              {/* Buyer over policyholder in one column: seven columns side by
                  side cut both names to a few letters on a laptop. */}
              <th>
                {t('claims.fields.buyer')} / {t('claims.fields.policyholder')}
              </th>
              <th className="num">{t('claims.fields.claimed')}</th>
              <th className="num">{t('claims.fields.indemnity')}</th>
              {/* The unit is in each cell; the rule behind the count on hover. */}
              <th className="num" title={t('claims.ageHint')}>
                {t('claims.fields.ageColumn')}
              </th>
              <th>{t('claims.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <ClaimRow key={c.id} claim={c} locale={locale} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function ClaimRow({ claim, locale }: { claim: Claim; locale: string }) {
  const { t } = useTranslation()
  return (
    <tr>
      <td className="whitespace-nowrap">
        <Link to={`/claims/${claim.id}`} className="font-medium text-accent-600 hover:underline">
          {claim.claim_number}
        </Link>
        {claim.noa_reported_late && (
          <span className="ml-2">
            <Badge tone="negStrong">
              {t('claims.noaLateShort')}
            </Badge>
          </span>
        )}
      </td>
      <td className="cell-fill">
        <Truncate text={claim.buyer_name} className="max-w-none">
          <Link to={`/entities/${claim.buyer_entity_id}`} className="hover:underline">
            {claim.buyer_name}
          </Link>
        </Truncate>
        <Truncate text={claim.policyholder_name} className="max-w-none text-[0.75rem] text-slate-500" />
      </td>
      <td className="num">
        {formatAmount(Number(claim.claimed_amount), locale)} {claim.currency_code}
      </td>
      <td className="num">
        {claim.approved_indemnity === null
          ? EM_DASH
          : `${formatAmount(Number(claim.approved_indemnity), locale)} ${claim.currency_code}`}
      </td>
      <td className="num" title={t('claims.ageHint')}>
        {claim.assessment_age_days === null
          ? EM_DASH
          : t('policies.terms.days', { count: Math.round(Number(claim.assessment_age_days)) })}
      </td>
      <td className="whitespace-nowrap">
        <Badge tone={STATUS_TONE[claim.status]}>{t(`claims.statuses.${claim.status}`)}</Badge>
      </td>
    </tr>
  )
}

