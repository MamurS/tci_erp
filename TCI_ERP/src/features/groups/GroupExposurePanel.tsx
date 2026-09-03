/** What the group holds, and against what ceiling.
 *
 * The exposure is the sum of the in-force member limits in UZS by the standard
 * fx rule. Rows whose currency has no rate are NOT silently dropped to zero:
 * they are counted and said out loud, because a group with missing rates is
 * incomplete, not small.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Table } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { exposureByMember, exposureByPolicyholder, utilisationTone } from './group'
import type { GroupExposure, GroupExposureLine, GroupLimit } from './types'

interface GroupExposurePanelProps {
  exposure: GroupExposure | null
  lines: GroupExposureLine[]
  groupLimit: GroupLimit | null
  mayManageLimit: boolean
  onSetLimit: () => void
  onEndLimit: () => void
}

export function GroupExposurePanel({
  exposure,
  lines,
  groupLimit,
  mayManageLimit,
  onSetLimit,
  onEndLimit,
}: GroupExposurePanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const exposureUzs = Number(exposure?.exposure_uzs ?? 0)
  const limitUzs = groupLimit ? Number(groupLimit.max_amount) : null
  // The headroom shown here is against the limit as recorded. The authoritative
  // arithmetic — including the fx conversion of a non-UZS group limit — is
  // tci.group_exposure_preflight, which the decision form calls.
  const utilisation =
    limitUzs && limitUzs > 0 && groupLimit?.currency_code === 'UZS'
      ? Math.round((exposureUzs * 10000) / limitUzs) / 100
      : null
  const tone = utilisationTone(utilisation)

  const byMember = exposureByMember(lines)
  const byPolicyholder = exposureByPolicyholder(lines)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t('groups.exposure.title')}</h3>
          <p className="mt-1 text-[13px] text-slate-500">{t('groups.exposure.hint')}</p>
        </div>
        {mayManageLimit && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onSetLimit}>
              {groupLimit ? t('groups.actions.changeGroupLimit') : t('groups.actions.setGroupLimit')}
            </Button>
            {groupLimit && (
              <Button size="sm" variant="ghost" onClick={onEndLimit}>
                {t('groups.actions.endGroupLimit')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={t('groups.exposure.total')} value={`${formatAmount(exposureUzs, locale)} UZS`} />
        <Figure
          label={t('groups.exposure.groupLimit')}
          value={
            groupLimit
              ? `${formatAmount(Number(groupLimit.max_amount), locale)} ${groupLimit.currency_code}`
              : '—'
          }
        />
        <Figure
          label={t('groups.exposure.utilisation')}
          value={utilisation === null ? '—' : `${utilisation.toFixed(1)}%`}
          tone={tone}
        />
      </div>

      {!groupLimit && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
          {t('groups.exposure.noGroupLimit')}
        </p>
      )}
      {Number(exposure?.missing_rates ?? 0) > 0 && (
        <p className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('groups.exposure.missingRates', { count: Number(exposure?.missing_rates ?? 0) })}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="text-[13px] text-slate-500">{t('groups.exposure.empty')}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[13px] font-semibold text-slate-700">
              {t('groups.exposure.byMember')}
            </h4>
            <Table dense>
              <thead>
                <tr>
                  <th className="text-left">{t('groups.exposure.member')}</th>
                  <th className="text-right">{t('groups.exposure.limits')}</th>
                  <th className="text-right">{t('groups.exposure.amountUzs')}</th>
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
                        <span className="ml-1.5">
                          <Badge tone="warn">{t('groups.exposure.rateMissingShort')}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="num text-right">{row.limits}</td>
                    <td className="num text-right">{formatAmount(row.exposureUzs, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div>
            <h4 className="mb-1.5 text-[13px] font-semibold text-slate-700">
              {t('groups.exposure.byPolicyholder')}
            </h4>
            <Table dense>
              <thead>
                <tr>
                  <th className="text-left">{t('groups.exposure.policyholder')}</th>
                  <th className="text-right">{t('groups.exposure.policies')}</th>
                  <th className="text-right">{t('groups.exposure.amountUzs')}</th>
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
                    <td className="num text-right">{row.policies}</td>
                    <td className="num text-right">{formatAmount(row.exposureUzs, locale)}</td>
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

function Figure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
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
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className={`num mt-0.5 text-sm font-semibold ${colour}`}>{value}</p>
    </div>
  )
}
