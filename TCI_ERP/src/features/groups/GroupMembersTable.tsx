/** The members table: who is in the group, how each is rated, what each holds
 * and what each already owes us in open claims. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, COL, Table } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'
import type { Claim } from '../claims/types'
import { exposureByMember } from './group'
import type { GroupExposureLine, GroupMembership } from './types'

/** Statuses that still owe an answer or a payment. A settled or declined claim
 * is history and does not belong in a "what is open on this group" figure. */
const OPEN_CLAIM_STATUSES = new Set([
  'draft',
  'filed',
  'under_assessment',
  'info_requested',
  'approved',
  'partially_approved',
])

interface GroupMembersTableProps {
  members: GroupMembership[]
  focusId: string
  names: Map<string, string>
  grades: Map<string, string> | undefined
  lines: GroupExposureLine[]
  claims: Claim[]
}

export function GroupMembersTable({
  members,
  focusId,
  names,
  grades,
  lines,
  claims,
}: GroupMembersTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const exposure = new Map(exposureByMember(lines).map((r) => [r.memberId, r]))
  const openClaims = new Map<string, number>()
  for (const c of claims) {
    if (!OPEN_CLAIM_STATUSES.has(c.status)) continue
    openClaims.set(c.buyer_entity_id, (openClaims.get(c.buyer_entity_id) ?? 0) + 1)
  }

  return (
    <Table dense columns={[COL.fill, COL.count, COL.grade, COL.count, COL.amount, COL.count]}>
      <thead>
        <tr>
          <th>{t('groups.members.company')}</th>
          <th className="num">{t('groups.members.depth')}</th>
          <th>{t('groups.members.grade')}</th>
          <th className="num">{t('groups.members.limits')}</th>
          <th className="num">{t('groups.members.exposureUzs')}</th>
          <th className="num">{t('groups.members.openClaims')}</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const grade = grades?.get(m.member_id)
          const exp = exposure.get(m.member_id)
          return (
            <tr key={m.member_id}>
              <td>
                {/* Name, badge and «эта организация» wrap as whole pieces,
                    never a label broken over two lines. */}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link to={`/entities/${m.member_id}`} className="text-accent-700 hover:underline">
                    {names.get(m.member_id) ?? m.member_id}
                  </Link>
                  {m.member_is_ultimate_parent && <Badge tone="accent">{t('groups.ultimateParent')}</Badge>}
                  {m.member_id === focusId && (
                    <span className="whitespace-nowrap text-caption text-slate-500">
                      {t('groups.members.thisCompany')}
                    </span>
                  )}
                </span>
              </td>
              <td className="num">{m.depth}</td>
              <td>
                {grade ? <Badge tone={gradeTone(grade)}>{grade}</Badge> : <span>—</span>}
              </td>
              <td className="num">{exp?.limits ?? 0}</td>
              <td className="num">
                {exp ? formatAmount(exp.exposureUzs, locale) : '—'}
              </td>
              <td className="num">{openClaims.get(m.member_id) ?? 0}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
