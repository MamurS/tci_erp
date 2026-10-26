/** What the group holds, and against what ceiling.
 *
 * The exposure is the sum of the in-force member limits in UZS by the standard
 * fx rule. Rows whose currency has no rate are NOT silently dropped to zero:
 * they are counted and said out loud, because a group with missing rates is
 * incomplete, not small.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  COL,
  SectionTitle,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatCompact, formatPercent } from '../../lib/format'
import { exposureByMember, exposureByPolicyholder, utilisationTone } from './group'
import { GroupCapAmount } from './GroupCapAmount'
import type { GroupExposure, GroupExposureLine, GroupLimit, GroupLimitStatus } from './types'

interface GroupExposurePanelProps {
  exposure: GroupExposure | null
  lines: GroupExposureLine[]
  groupLimit: GroupLimit | null
  /** The group's row of tci.v_group_limit_status: utilisation and the
   * over-limit verdict as the database computes them. */
  status: GroupLimitStatus | null
  mayManageLimit: boolean
  onSetLimit: () => void
  onEndLimit: () => void
}

export function GroupExposurePanel({
  exposure,
  lines,
  groupLimit,
  status,
  mayManageLimit,
  onSetLimit,
  onEndLimit,
}: GroupExposurePanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const exposureUzs = Number(exposure?.exposure_uzs ?? 0)
  // Utilisation is the DATABASE's (tci.v_group_limit_status): it converts a
  // cap in any currency at the latest rate and makes the over_limit
  // comparison itself. Computing it here only for a UZS cap left an 800,000
  // USD limit at «—» while the workbench showed the same group at 106%.
  const limitUzs = toNumber(status?.limit_uzs)
  const utilisation = groupLimit ? toNumber(status?.utilisation_pct) : null
  const over = Boolean(groupLimit && status?.over_limit)
  const tone = over ? 'neg' : utilisationTone(utilisation)
  const utilisationMeta =
    !groupLimit || !status
      ? undefined
      : limitUzs === null
        ? t('groups.exposure.limitNoRate', { currency: groupLimit.currency_code })
        : over
          ? t('groups.exposure.overBy', { amount: `${formatCompact(exposureUzs - limitUzs, locale)} UZS` })
          : t('groups.exposure.headroom', { amount: `${formatCompact(limitUzs - exposureUzs, locale)} UZS` })

  const byMember = exposureByMember(lines)
  const byPolicyholder = exposureByPolicyholder(lines)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={t('groups.exposure.hint')}
        actions={
          mayManageLimit && (
            <>
              <Button size="sm" variant="secondary" onClick={onSetLimit}>
                {groupLimit ? t('groups.actions.changeGroupLimit') : t('groups.actions.setGroupLimit')}
              </Button>
              {groupLimit && (
                <Button size="sm" variant="dangerOutline" onClick={onEndLimit}>
                  {t('groups.actions.endGroupLimit')}
                </Button>
              )}
            </>
          )
        }
      >
        {t('groups.exposure.title')}
      </SectionTitle>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t('groups.exposure.total')} value={`${formatAmount(exposureUzs, locale)} UZS`} />
        <Figure
          label={t('groups.exposure.groupLimit')}
          value={
            groupLimit ? (
              <GroupCapAmount
                amount={groupLimit.max_amount}
                currency={groupLimit.currency_code}
                amountUzs={status ? status.limit_uzs : undefined}
              />
            ) : (
              EM_DASH
            )
          }
        />
        <Figure
          label={t('groups.exposure.utilisation')}
          value={utilisation === null ? EM_DASH : formatPercent(utilisation / 100, locale)}
          meta={utilisationMeta}
          tone={tone}
        />
      </div>

      {!groupLimit && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-small text-slate-600">
          {t('groups.exposure.noGroupLimit')}
        </p>
      )}
      {Number(exposure?.missing_rates ?? 0) > 0 && (
        <p className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-3 text-small text-warn-500">
          {t('groups.exposure.missingRates', { count: Number(exposure?.missing_rates ?? 0) })}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="text-small text-slate-500">{t('groups.exposure.empty')}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-small font-semibold text-slate-700">
              {t('groups.exposure.byMember')}
            </h4>
            <Table dense columns={[COL.fill, COL.count, COL.amount]}>
              <thead>
                <tr>
                  <th>{t('groups.exposure.member')}</th>
                  <th className="num">{t('groups.exposure.limits')}</th>
                  <th className="num">{t('groups.exposure.amountUzs')}</th>
                </tr>
              </thead>
              <tbody>
                {byMember.map((row) => (
                  <tr key={row.memberId}>
                    <td>
                      <Link
                        to={`/entities/${row.memberId}`}
                        className="text-accent-700 hover:underline"
                      >
                        {row.memberName}
                      </Link>
                      {row.missingRates > 0 && (
                        <span className="ml-2">
                          <Badge tone="warn">{t('groups.exposure.rateMissingShort')}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="num">{row.limits}</td>
                    <td className="num">{formatAmount(row.exposureUzs, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div>
            <h4 className="mb-2 text-small font-semibold text-slate-700">
              {t('groups.exposure.byPolicyholder')}
            </h4>
            <Table dense columns={[COL.fill, COL.count, COL.amount]}>
              <thead>
                <tr>
                  <th>{t('groups.exposure.policyholder')}</th>
                  <th className="num">{t('groups.exposure.policies')}</th>
                  <th className="num">{t('groups.exposure.amountUzs')}</th>
                </tr>
              </thead>
              <tbody>
                {byPolicyholder.map((row) => (
                  <tr key={row.policyholderId}>
                    <td>
                      <Link
                        to={`/entities/${row.policyholderId}`}
                        className="text-accent-700 hover:underline"
                      >
                        {row.policyholderName}
                      </Link>
                    </td>
                    <td className="num">{row.policies}</td>
                    <td className="num">{formatAmount(row.exposureUzs, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  )
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function Figure({
  label,
  value,
  meta,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  /** One short line under the value: the breach, the headroom, a missing rate. */
  meta?: string
  tone?: 'neutral' | 'pos' | 'warn' | 'neg'
}) {
  const colour =
    tone === 'neg'
      ? 'text-neg-500'
      : tone === 'warn'
        ? 'text-warn-500'
        : tone === 'pos'
          ? 'text-pos-500'
          : 'text-slate-900'
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-caption text-slate-500">{label}</p>
      <p className={`mt-0.5 text-body font-semibold tabular-nums ${colour}`}>{value}</p>
      {meta && (
        <p className={`mt-0.5 text-caption ${tone === 'neg' ? 'text-neg-500' : 'text-slate-500'}`}>{meta}</p>
      )}
    </div>
  )
}
