/**
 * A data request in triage — a company to create, statements to bring up to
 * date, or the answer to one's own request: what was asked, for whom, by
 * whom, who holds it and where it stands (tci.entity_requests through the
 * data feature's own query).
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { DescriptionList } from '../../../components/ui'
import { EM_DASH, formatMoment } from '../../../lib/format'
import { useEntityRequest, useStaffDirectory } from '../../data/api'
import { STATUS_TONE } from '../../data/requests'
import { refName, useCountries } from '../../entities/api'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { personName } from '../rowText'
import { GenericBody } from './GenericBody'
import { BodySkeleton, Section, StatusBadge } from './parts'

export function DataBody(props: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  const { data: request, isLoading, isError } = useEntityRequest(lead.object_type === 'entity_request' ? lead.object_id : undefined)
  const { data: staff } = useStaffDirectory()
  const { data: countries } = useCountries()

  if (isLoading) return <BodySkeleton strip={false} />
  if (isError || !request) return <GenericBody {...props} />

  const country = request.country_code
    ? refName(countries?.find((c) => c.code === request.country_code), locale) || request.country_code
    : null
  return (
    <Section title={t('agenda.triage.data.title')}>
      <DescriptionList
        columns={2}
        items={[
          {
            label: t('agenda.triage.data.number'),
            value: (
              <Link to={`/data/requests/${request.id}`} className="text-accent-600 hover:underline">
                {request.request_number}
              </Link>
            ),
          },
          { label: t('agenda.triage.data.kind'), value: t(`data.kinds.${request.kind}`) },
          {
            label: t('agenda.triage.data.company'),
            value: request.entity_id ? (
              <Link to={`/entities/${request.entity_id}`} className="text-accent-600 hover:underline">
                {request.requested_name ?? t('agenda.triage.data.openCompany')}
              </Link>
            ) : (
              (request.requested_name ?? EM_DASH)
            ),
          },
          { label: t('agenda.triage.data.country'), value: country ?? EM_DASH },
          { label: t('agenda.triage.data.registration'), value: request.registration_number ?? EM_DASH },
          {
            label: t('agenda.triage.data.requestedBy'),
            value: `${personName(request.requested_by, staff) ?? EM_DASH} · ${formatMoment(request.created_at, locale)}`,
          },
          {
            label: t('agenda.triage.data.holder'),
            value: request.assigned_to ? (personName(request.assigned_to, staff) ?? EM_DASH) : t('agenda.triage.data.nobody'),
          },
          {
            label: t('agenda.triage.data.state'),
            value: <StatusBadge tone={STATUS_TONE[request.status]}>{t(`data.statuses.${request.status}`)}</StatusBadge>,
          },
        ]}
      />
      {request.resolution_note && (
        <p className="mt-3 border-l-2 border-slate-200 pl-3 text-small leading-relaxed text-slate-700">{request.resolution_note}</p>
      )}
    </Section>
  )
}
