/** «Заявки на страхование» on the company card: submissions where this
 * company is the applicant, or appears in someone's buyer package. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  COL,
  EmptyState,
  labelCol,
  labelsCol,
  LinkRow,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH } from '../../lib/format'
import { useRequestsForEntity } from './api'
import { owningRole, requestAgeDays, statusTone } from './machine'

export function EntityRequestsSection({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { data: rows, isLoading } = useRequestsForEntity(entityId)
  const nowIso = new Date().toISOString()

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!rows?.length) {
    return <EmptyState title={t('requests.noneForEntity')} hint={t('requests.noneForEntityHint')} />
  }

  return (
    <Table dense columns={[COL.code, labelsCol(['requestRole', 'requestRole']), COL.fill, labelCol('requestStatus'), '12rem', COL.count]}>
      <thead>
        <tr>
          <th>{t('requests.fields.number')}</th>
          <th>{t('requests.fields.role')}</th>
          <th>{t('requests.fields.applicant')}</th>
          <th>{t('requests.fields.status')}</th>
          <th>{t('requests.fields.waitingOn')}</th>
          <th className="num">{t('requests.fields.ageDays')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ request, asApplicant, asBuyer }) => {
          const owner = owningRole(request.status)
          const age = requestAgeDays(request.submitted_at, nowIso)
          return (
            // The row opens the submission; the applicant, when it is
            // another company, opens that company.
            <LinkRow key={request.id} to={`/requests/${request.id}`} className="transition-colors hover:bg-slate-50">
              <td className="font-medium whitespace-nowrap text-slate-800 tabular-nums">{request.request_number}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {asApplicant && (
                    <Badge tone="accent">{t('requests.roleApplicant')}</Badge>
                  )}
                  {asBuyer && <Badge tone="neutral">{t('requests.roleBuyer')}</Badge>}
                </span>
              </td>
              <td className="text-slate-600">
                <Truncate text={request.legal_entities?.name}>
                  {request.legal_entities?.name && request.entity_id !== entityId ? (
                    <Link to={`/entities/${request.entity_id}`} className="text-accent-600 hover:text-accent-500">
                      {request.legal_entities.name}
                    </Link>
                  ) : (
                    (request.legal_entities?.name ?? EM_DASH)
                  )}
                </Truncate>
              </td>
              <td>
                <Badge tone={statusTone(request.status)}>
                  {t(`requests.statuses.${request.status}`)}
                </Badge>
              </td>
              <td className="text-slate-500">{owner ? <Truncate text={t(`roles.${owner}`)} className="max-w-none" /> : EM_DASH}</td>
              <td className="num">{age ?? EM_DASH}</td>
            </LinkRow>
          )
        })}
      </tbody>
    </Table>
  )
}
