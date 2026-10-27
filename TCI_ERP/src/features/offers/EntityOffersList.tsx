/** «Коммерческие предложения» on the company card — prospects included: every
 * offer prepared for this organisation, with its status (expired derived),
 * validity and the submission it belongs to. The row opens the offer
 * screen, the submission number the submission; «Скачать PDF» prints the version the client sees (or the latest)
 * through the same renderer as the preview. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'

import {
  actionsCol,
  Badge,
  Callout,
  Card,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  RowActions,
  SectionTitle,
  Table,
} from '../../components/ui'
import { formatDate, formatMoment } from '../../lib/format'
import { countriesQuery } from '../entities/api'
import { offerVersionQuery, useEntityOffers } from './api'
import { staffRenderInput } from './kp/input'
import { statusTone } from './machine'
import type { OfferRow } from './model'
import { offerEditPath } from './paths'
import { useOfferPrinter } from './useOfferPrinter'

const STATUS_COL = labelCol('offerStatus')
const ACTIONS_COL = actionsCol([], 1)

export function EntityOffersList({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: offers, isLoading } = useEntityOffers(entityId)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const printer = useOfferPrinter(() => setError(t('offers.errors.printFailed')))

  const download = (o: OfferRow) => {
    const versionNo = o.published_version_no ?? o.current_version_no
    if (!versionNo) return
    setError(null)
    printer.print(async () => {
      const [version, countries] = await Promise.all([
        qc.fetchQuery(offerVersionQuery(o.id, versionNo)),
        qc.fetchQuery(countriesQuery),
      ])
      return version ? staffRenderInput(o, version, countries) : null
    })
  }

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3">{t('offers.entity.title')}</SectionTitle>
      {error && <Callout tone="neg" title={error} className="mb-3" />}
      {isLoading ? null : !offers?.length ? (
        <EmptyState title={t('offers.entity.empty')} hint={t('offers.entity.emptyHint')} />
      ) : (
        <Table dense columns={[COL.code, COL.code, STATUS_COL, COL.date, COL.moment, COL.fill, ACTIONS_COL]} fillMin="6rem">
          <thead>
            <tr>
              <th>{t('offers.entity.columns.number')}</th>
              <th>{t('offers.entity.columns.submission')}</th>
              <th>{t('offers.entity.columns.status')}</th>
              <th>{t('offers.entity.columns.validUntil')}</th>
              <th>{t('offers.entity.columns.updated')}</th>
              <th>{t('offers.entity.columns.language')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              // The row opens the offer; the submission number opens the
              // submission at its offer.
              <LinkRow key={o.id} to={offerEditPath(o.id, o.published_version_no ?? o.current_version_no)}>
                <td>
                  <Link
                    to={offerEditPath(o.id, o.published_version_no ?? o.current_version_no)}
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
                <RowActions>
                  <button
                    type="button"
                    onClick={() => download(o)}
                    disabled={printer.busy}
                    title={`${t('offers.actions.downloadPdf')} — ${t('offers.pdfHint')}`}
                    aria-label={t('offers.actions.downloadPdfNumber', { number: o.offer_number })}
                    className="inline-flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent-500 disabled:opacity-50 [&_svg]:size-4"
                  >
                    <Download />
                  </button>
                </RowActions>
              </LinkRow>
            ))}
          </tbody>
        </Table>
      )}
      {printer.frame}
    </Card>
  )
}
