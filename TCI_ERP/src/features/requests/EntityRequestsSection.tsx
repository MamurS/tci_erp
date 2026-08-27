/** «Заявки на страхование» on the company card: submissions where this
 * company is the applicant, or appears in someone's buyer package. */

import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, Spinner, Table } from '../../components/ui'
import { EM_DASH } from '../../lib/format'
import { useRequestsForEntity } from './api'
import { owningRole, requestAgeDays, statusTone } from './machine'

export function EntityRequestsSection({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: rows, isLoading } = useRequestsForEntity(entityId)
  const nowIso = new Date().toISOString()

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!rows?.length) {
    return <EmptyState title={t('requests.noneForEntity')} hint={t('requests.noneForEntityHint')} />
  }

  return (
    <Table dense>
      <thead>
        <tr>
          <th>{t('requests.fields.number')}</th>
          <th>{t('requests.fields.role')}</th>
          <th>{t('requests.fields.applicant')}</th>
          <th>{t('requests.fields.status')}</th>
          <th>{t('requests.fields.waitingOn')}</th>
          <th className="text-right">{t('requests.fields.ageDays')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ request, asApplicant, asBuyer }) => {
          const owner = owningRole(request.status)
          const age = requestAgeDays(request.submitted_at, nowIso)
          return (
            <tr
              key={request.id}
              onClick={() => void navigate(`/requests/${request.id}`)}
              className="cursor-pointer transition-colors hover:bg-slate-50"
            >
              <td className="num font-medium text-slate-800">{request.request_number}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {asApplicant && (
                    <Badge tone="accent">{t('requests.roleApplicant')}</Badge>
                  )}
                  {asBuyer && <Badge tone="neutral">{t('requests.roleBuyer')}</Badge>}
                </span>
              </td>
              <td className="text-slate-600">{request.legal_entities?.name ?? EM_DASH}</td>
              <td>
                <Badge tone={statusTone(request.status)}>
                  {t(`requests.statuses.${request.status}`)}
                </Badge>
              </td>
              <td className="text-slate-500">{owner ? t(`roles.${owner}`) : EM_DASH}</td>
              <td className="num text-right">{age ?? EM_DASH}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
