/** «Коммерческие предложения» on the company card — prospects included: every
 * offer prepared for this organisation, with its status (expired derived),
 * validity and the submission it belongs to. */

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Badge, Card, COL, EmptyState, labelCol, SectionTitle, Table } from '../../components/ui'
import { formatDate, formatMoment } from '../../lib/format'
import { useEntityOffers } from './api'
import { statusTone } from './machine'
import { offerPrintPath } from './paths'

const STATUS_COL = labelCol('offerStatus')

export function EntityOffersList({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: offers, isLoading } = useEntityOffers(entityId)

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3">{t('offers.entity.title')}</SectionTitle>
      {isLoading ? null : !offers?.length ? (
        <EmptyState title={t('offers.entity.empty')} hint={t('offers.entity.emptyHint')} />
      ) : (
        <Table dense columns={[COL.code, COL.code, STATUS_COL, COL.date, COL.moment, COL.fill]} fillMin="6rem">
          <thead>
            <tr>
              <th>{t('offers.entity.columns.number')}</th>
              <th>{t('offers.entity.columns.submission')}</th>
              <th>{t('offers.entity.columns.status')}</th>
              <th>{t('offers.entity.columns.validUntil')}</th>
              <th>{t('offers.entity.columns.updated')}</th>
              <th>{t('offers.entity.columns.language')}</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link
                    to={offerPrintPath(o.id, o.published_version_no ?? o.current_version_no)}
                    className="font-mono text-accent-600 hover:underline"
                  >
                    {o.offer_number}
                  </Link>
                </td>
                <td>
                  <Link to={`/requests/${o.insurance_request_id}?focus=offer`} className="text-accent-600 hover:underline">
                    {o.request_number}
                  </Link>
                </td>
                <td>
                  <Badge tone={statusTone(o.effective_status)}>{t(`offers.statuses.${o.effective_status}`)}</Badge>
                </td>
                <td className="tabular-nums">{formatDate(o.valid_until, locale)}</td>
                <td className="tabular-nums">{formatMoment(o.updated_at, locale)}</td>
                <td>{t(`offers.languages.${o.language}`)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}
