/**
 * «Авторешения» — every limit decided automatically within a buyer's ADT
 * (tci.v_auto_decisions, migration 0061): when, for which buyer, under which
 * policy, how much, what is left of the ADT now, and whether the limit is
 * still in force. The credit desk's own view (views.ts); RLS shows the rows
 * to admin and credit underwriting only.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Card,
  COL,
  EmptyState,
  KeyFigures,
  LinkRow,
  labelCol,
  Select,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { adtNumber, filterReport, reportBuyers } from '../adt'
import { useAutoDecisionSettings, useAutoDecisions } from '../adtApi'
import { EntityLink } from './parts'

const COLUMNS = [COL.date, COL.fill, COL.fill, COL.money, COL.count, labelCol('limitLifecycle')]

export function AutoDecisionsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data, isLoading } = useAutoDecisions(true)
  const { data: settings } = useAutoDecisionSettings()
  const [buyer, setBuyer] = useState('')

  const all = useMemo(() => data ?? [], [data])
  const buyers = useMemo(() => reportBuyers(all), [all])
  const rows = useMemo(() => filterReport(all, buyer), [all, buyer])

  return (
    <div>
      <ViewBar
        hint={t('limits.workbench.auto.subtitle')}
        actions={
          all.length > 0 ? (
            <Select
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              className="max-w-64"
              aria-label={t('limits.fields.buyer')}
            >
              <option value="">{t('limits.workbench.auto.allBuyers')}</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      {isLoading ? (
        <Spinner />
      ) : !all.length ? (
        <Card className="p-6">
          <EmptyState
            title={t('limits.workbench.auto.empty')}
            hint={t(settings?.enabled ? 'limits.workbench.auto.emptyHint' : 'limits.workbench.auto.emptyOffHint')}
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          <KeyFigures
            className=""
            items={[
              { label: t('limits.workbench.auto.count'), value: formatAmount(rows.length, locale) },
              { label: t('limits.workbench.auto.buyers'), value: formatAmount(new Set(rows.map((r) => r.buyer_id)).size, locale) },
              {
                label: t('limits.workbench.auto.switch'),
                value: settings ? t(settings.enabled ? 'limits.workbench.auto.on' : 'limits.workbench.auto.off') : EM_DASH,
                tone: settings && !settings.enabled ? 'warn' : 'default',
                text: true,
              },
            ]}
          />

          <Table dense columns={COLUMNS}>
            <thead>
              <tr>
                <th>{t('limits.workbench.auto.date')}</th>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('limits.fields.policyAndPolicyholder')}</th>
                <th className="num">{t('limits.fields.approvedAmount')}</th>
                <th className="num">{t('limits.workbench.auto.adtLeft')}</th>
                <th>{t('limits.workbench.auto.lifecycle')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const left = adtNumber(r.adt_remaining_now)
                // The row opens the limit; the buyer opens the company, the
                // policy number the policy, the policyholder theirs.
                return (
                  <LinkRow key={r.attempt_id} to={`/limits/${r.request_id}`}>
                    <td>{formatDate(r.decided_at, locale)}</td>
                    <td>
                      <Truncate text={r.buyer_name} className="max-w-none">
                        <EntityLink id={r.buyer_id} name={r.buyer_name} />
                      </Truncate>
                    </td>
                    <td>
                      {r.policy_id && r.policy_number ? (
                        <Link to={`/policies/${r.policy_id}`} className="block whitespace-nowrap text-accent-600 hover:text-accent-500">
                          {r.policy_number}
                        </Link>
                      ) : (
                        <span className="block whitespace-nowrap">{r.policy_number ?? EM_DASH}</span>
                      )}
                      <Truncate text={r.policyholder_name ?? EM_DASH} className="max-w-none text-caption text-slate-500">
                        {r.policyholder_id && r.policyholder_name ? (
                          <Link to={`/entities/${r.policyholder_id}`} className="text-slate-500 hover:text-accent-600 hover:underline">
                            {r.policyholder_name}
                          </Link>
                        ) : (
                          (r.policyholder_name ?? EM_DASH)
                        )}
                      </Truncate>
                    </td>
                    <td className="num">
                      {formatAmount(adtNumber(r.amount), locale)} {r.currency_code}
                    </td>
                    <td className="num" title={r.adt_status ? t(`limits.adt.statuses.${r.adt_status}`) : undefined}>
                      {left === null || r.adt_total === null
                        ? EM_DASH
                        : t('limits.auto.attempt.leftOf', { left, total: r.adt_total })}
                    </td>
                    <td>
                      <Badge tone={r.lifecycle === 'effective' ? 'pos' : 'neutral'}>
                        {t(`limits.lifecycles.${r.lifecycle}`)}
                      </Badge>
                    </td>
                  </LinkRow>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
