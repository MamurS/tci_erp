/**
 * «Группы» — every corporate group against its cap (tci.v_group_limit_status):
 * in-force exposure in UZS, the live group limit and how much of it is used,
 * breaches first. Setting or ending a cap is done on the group tab of the
 * parent company, where the structure and the members are.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, ViewBar, Spinner, Table } from '../../../components/ui'
import { formatAmount, formatPercent } from '../../../lib/format'
import { num } from '../../portfolio/aggregate'
import { useCountryName } from '../../portfolio/useCountryName'
import { useGroupLimitStatus } from './api'
import { groupState, sortGroups } from './model'
import type { GroupState } from './model'
import { EntityLink, Uzs } from './parts'

const STATE_TONE: Record<GroupState, 'neg' | 'warn' | 'pos' | 'neutral'> = {
  over: 'neg',
  near: 'warn',
  within: 'pos',
  uncapped: 'neutral',
}

export function GroupsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useGroupLimitStatus()
  const rows = useMemo(() => sortGroups(data ?? []), [data])

  return (
    <div>
      <ViewBar hint={t('limits.workbench.groups.subtitle')} />

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('limits.workbench.groups.empty')} hint={t('limits.workbench.groups.emptyHint')} />
        </Card>
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('portfolio.credit.group')}</th>
              <th>{t('portfolio.credit.country')}</th>
              <th className="text-right">{t('limits.workbench.groups.members')}</th>
              <th className="text-right">{t('portfolio.credit.limits')}</th>
              <th className="text-right">{t('portfolio.credit.exposure')}</th>
              <th className="text-right">{t('limits.workbench.groups.cap')}</th>
              <th className="text-right">{t('limits.workbench.groups.used')}</th>
              <th>{t('limits.workbench.groups.state')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const state = groupState(g)
              return (
                <tr key={g.ultimate_parent_id}>
                  <td>
                    <EntityLink id={g.ultimate_parent_id} name={g.ultimate_parent_name} tab="group" />
                  </td>
                  <td className="text-slate-600">{countryName(g.ultimate_parent_country)}</td>
                  <td className="num text-right">
                    {formatAmount(g.members_with_limits, locale)} / {formatAmount(g.members_count, locale)}
                  </td>
                  <td className="num text-right">{formatAmount(g.limits_count, locale)}</td>
                  <td className="num text-right">
                    <Uzs value={g.exposure_uzs} />
                    {g.missing_rates > 0 && (
                      <span className="ml-1 text-warn-500" title={t('portfolio.missingRatesHint')}>
                        *
                      </span>
                    )}
                  </td>
                  <td className="num text-right whitespace-nowrap">
                    {g.limit_amount === null ? (
                      '—'
                    ) : (
                      <>
                        {formatAmount(num(g.limit_amount), locale)} {g.limit_currency}
                      </>
                    )}
                  </td>
                  <td className="num text-right">
                    {num(g.utilisation_pct) === null ? '—' : formatPercent((num(g.utilisation_pct) ?? 0) / 100, locale)}
                  </td>
                  <td>
                    <Badge tone={STATE_TONE[state]}>{t(`limits.workbench.groups.states.${state}`)}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
