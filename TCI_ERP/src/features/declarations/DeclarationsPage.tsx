/**
 * «Декларации оборота» — the staff queue.
 *
 * A declaration is priced evidence, so the two things this list has to make
 * obvious are: which ones are waiting on us, and which ones reported turnover
 * OUTSIDE cover. The second is amber, not red: it is a fact about the policy
 * to discuss, not an error in the data (DESIGN.md).
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, Field, PageHeader, Select, Spinner, Table, Truncate } from '../../components/ui'
import { EM_DASH, formatAmount, formatPeriod } from '../../lib/format'
import { useDeclarations } from './api'
import { DECLARATION_STATUSES } from './types'
import type { DeclarationStatus } from './types'
import { STATUS_TONE } from './status'


export function DeclarationsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const policyFilter = params.get('policy') ?? undefined
  const [status, setStatus] = useState<'' | DeclarationStatus>('')
  const { data, isLoading, isError } = useDeclarations(policyFilter)
  const locale = i18n.language

  const rows = useMemo(
    () => (data ?? []).filter((d) => !status || d.status === status),
    [data, status],
  )

  return (
    <div>
      <PageHeader
        title={t('declarations.title')}
        subtitle={t('declarations.subtitle')}
        actions={
          <Field label={t('declarations.fields.status')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | DeclarationStatus)}
            >
              <option value="">
                {t('common.all')} ({(data ?? []).length})
              </option>
              {/* Only the statuses the list holds, with their counts. */}
              {DECLARATION_STATUSES.filter((s) => s === status || (data ?? []).some((row) => row.status === s)).map((s) => (
                <option key={s} value={s}>
                  {t(`declarations.statuses.${s}`)} ({(data ?? []).filter((row) => row.status === s).length})
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      {isError ? (
        <EmptyState title={t('common.loadFailed')} hint={t('common.tryAgain')} />
      ) : isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('declarations.empty')} hint={t('declarations.emptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('declarations.fields.period')}</th>
              <th>{t('policies.fields.policyNumber')}</th>
              <th className="cell-fill w-[34%]">{t('policies.fields.policyholder')}</th>
              <th className="text-right">{t('declarations.fields.totalTurnover')}</th>
              <th>{t('declarations.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                onClick={() => void navigate(`/declarations/${d.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium whitespace-nowrap">
                  {/* The row opens on click; the link is what a keyboard reaches. */}
                  <Link to={`/declarations/${d.id}`} className="text-accent-700 hover:underline">
                    {formatPeriod(d.period_start, d.period_end, i18n.language)}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-slate-600">{d.policies?.policy_number ?? EM_DASH}</td>
                <td className="cell-fill text-slate-500">
                  <Truncate text={d.policies?.legal_entities?.name ?? EM_DASH} className="max-w-none" />
                </td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(d.total_insurable_turnover), locale)} {d.currency_code}
                  </span>
                </td>
                <td>
                  <Badge tone={STATUS_TONE[d.status]}>
                    {t(`declarations.statuses.${d.status}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
