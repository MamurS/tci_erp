/** The group section of the printed risk report.
 *
 * A limit on a company that belongs to a group is not a judgement about that
 * company alone, so the report says who the group is, what we already hold on
 * it and against what ceiling. A company that stands alone renders nothing —
 * an empty "Group" heading on a printed report is worse than no heading.
 */

import type { TFunction } from 'i18next'

import { formatAmount } from '../../../lib/format'
import {
  useCurrentGroupLimit,
  useEntityGroup,
  useGroupExposure,
  useGroupExposureLines,
} from '../../groups/api'
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
    <section className="rpt-section rpt-keep">
      <h2 className="rpt-h2">{t('report.sections2.groupExposure')}</h2>
      <table className="rpt-kv">
        <tbody>
          <tr>
            <td>{t('groups.ultimateParent')}</td>
            <td>{parentName}</td>
          </tr>
          <tr>
            <td>{t('groups.members.title')}</td>
            <td className="rpt-num" style={{ textAlign: 'left' }}>
              {members.length}
            </td>
          </tr>
          <tr className="is-strong">
            <td>{t('groups.exposure.total')}</td>
            <td>{formatAmount(Number(exposure.data?.exposure_uzs ?? 0), locale)} UZS</td>
          </tr>
          <tr>
            <td>{t('groups.exposure.groupLimit')}</td>
            <td>
              {groupLimit.data
                ? `${formatAmount(Number(groupLimit.data.max_amount), locale)} ${groupLimit.data.currency_code}`
                : t('groups.exposure.none')}
            </td>
          </tr>
        </tbody>
      </table>

      {byMember.length > 0 && (
        <table className="rpt-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>{t('groups.exposure.member')}</th>
              <th>{t('groups.exposure.limits')}</th>
              <th>{t('groups.exposure.amountUzs')}</th>
            </tr>
          </thead>
          <tbody>
            {byMember.map((row) => (
              <tr key={row.memberId}>
                <td>{row.memberName}</td>
                <td className="rpt-num">{row.limits}</td>
                <td className="rpt-num">{formatAmount(row.exposureUzs, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {Number(exposure.data?.missing_rates ?? 0) > 0 && (
        <p className="rpt-note is-amber">
          {t('groups.exposure.missingRates', { count: Number(exposure.data?.missing_rates ?? 0) })}
        </p>
      )}
    </section>
  )
}
