/** The group section of the printed risk report.
 *
 * A limit on a company that belongs to a group is not a judgement about that
 * company alone, so the report says who the group is, what we already hold on
 * it and against what ceiling. A company that stands alone renders nothing —
 * an empty "Group" heading on a printed report is worse than no heading.
 */

import type { TFunction } from 'i18next'

import { formatAmount } from '../../../lib/format'
import { useCurrentGroupLimit, useEntityGroup, useGroupExposure, useGroupExposureLines } from '../../groups/api'
import { exposureByMember } from '../../groups/group'

interface ReportGroupSectionProps {
  entityId: string
  t: TFunction
  locale: string
}

export function ReportGroupSection({ entityId, t, locale }: ReportGroupSectionProps) {
  const group = useEntityGroup(entityId)
  const members = group.data ?? []
  const parentId = members[0]?.ultimate_parent_id
  const exposure = useGroupExposure(parentId)
  const lines = useGroupExposureLines(parentId)
  const groupLimit = useCurrentGroupLimit(parentId)

  if (members.length <= 1) return null

  const byMember = exposureByMember(lines.data ?? [])
  const parentName = exposure.data?.ultimate_parent_name ?? ''

  return (
    <section className="report-section">
      <h2 className="report-h2">{t('report.sections.group')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-slate-500">{t('groups.ultimateParent')}</dt>
        <dd>{parentName}</dd>
        <dt className="text-slate-500">{t('groups.members.title')}</dt>
        <dd className="num">{members.length}</dd>
        <dt className="text-slate-500">{t('groups.exposure.total')}</dt>
        <dd className="num">
          {formatAmount(Number(exposure.data?.exposure_uzs ?? 0), locale)} UZS
        </dd>
        <dt className="text-slate-500">{t('groups.exposure.groupLimit')}</dt>
        <dd className="num">
          {groupLimit.data
            ? `${formatAmount(Number(groupLimit.data.max_amount), locale)} ${groupLimit.data.currency_code}`
            : t('groups.exposure.none')}
        </dd>
      </dl>

      {byMember.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-500">
              <th className="py-1">{t('groups.exposure.member')}</th>
              <th className="py-1 text-right">{t('groups.exposure.limits')}</th>
              <th className="py-1 text-right">{t('groups.exposure.amountUzs')}</th>
            </tr>
          </thead>
          <tbody>
            {byMember.map((row) => (
              <tr key={row.memberId} className="border-b border-slate-100">
                <td className="py-1">{row.memberName}</td>
                <td className="num py-1 text-right">{row.limits}</td>
                <td className="num py-1 text-right">{formatAmount(row.exposureUzs, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {Number(exposure.data?.missing_rates ?? 0) > 0 && (
        <p className="mt-2 text-xs text-warn-500">
          {t('groups.exposure.missingRates', { count: Number(exposure.data?.missing_rates ?? 0) })}
        </p>
      )}
    </section>
  )
}
