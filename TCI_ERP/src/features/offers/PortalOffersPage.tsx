/**
 * The portal's «Предложения»: the commercial offers published to this
 * policyholder or prospect (tci.v_client_offers — the published version only,
 * never a draft). Opening one records the first view; accepting it IS
 * accepting the submission (client_accept_offer → client_respond_to_submission),
 * and asking for changes hands it back to sales with the comment. An expired
 * offer can no longer be accepted — only renewed through a change request.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'

import {
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  Field,
  labelCol,
  LinkButton,
  Modal,
  PageHeader,
  Spinner,
  Table,
  Textarea,
} from '../../components/ui'
import { formatDate } from '../../lib/format'
import { useCountries } from '../entities/api'
import { useClientAcceptOffer, useClientOffers, useClientRequestOfferChanges, useClientViewOffer } from './api'
import { clientRenderInput } from './kp/input'
import { clientCanAccept, clientCanRequestChanges, statusTone } from './machine'
import { printOfferFrame } from './printOfferFrame'
import { OfferPreview, type OfferPreviewHandle } from './OfferPreview'
import { portalOfferPath } from './paths'
import { useOfferDocument } from './useOfferDocument'

const STATUS_COL = labelCol('offerStatus')

export function PortalOffersPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: offers, isLoading } = useClientOffers()

  return (
    <div>
      <PageHeader title={t('offers.portal.title')} subtitle={t('offers.portal.subtitle')} />
      {isLoading ? (
        <Spinner />
      ) : !offers?.length ? (
        <Card className="p-5">
          <EmptyState title={t('offers.portal.empty')} hint={t('offers.portal.emptyHint')} />
        </Card>
      ) : (
        <Table columns={[COL.code, COL.fill, COL.date, COL.date, STATUS_COL, '8rem']} fillMin="10rem">
          <thead>
            <tr>
              <th>{t('offers.portal.columns.number')}</th>
              <th>{t('offers.portal.columns.submission')}</th>
              <th>{t('offers.portal.columns.published')}</th>
              <th>{t('offers.portal.columns.validUntil')}</th>
              <th>{t('offers.portal.columns.status')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td className="font-mono">{o.offer_number}</td>
                <td>{o.request_number}</td>
                <td className="tabular-nums">{o.published_at ? formatDate(o.published_at, locale) : '—'}</td>
                <td className="tabular-nums">{formatDate(o.valid_until, locale)}</td>
                <td>
                  <Badge tone={statusTone(o.effective_status)}>{t(`offers.statuses.${o.effective_status}`)}</Badge>
                </td>
                <td>
                  <LinkButton size="sm" variant="secondary" to={portalOfferPath(o.id)}>
                    {t('offers.portal.open')}
                  </LinkButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

export function PortalOfferPage() {
  const { offerId } = useParams<{ offerId: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: offers, isLoading } = useClientOffers()
  const offer = offers?.find((o) => o.id === offerId) ?? null
  const { data: countries, isLoading: countriesLoading } = useCountries()
  const input = useMemo(
    () => (offer && !countriesLoading ? clientRenderInput(offer, countries) : null),
    [offer, countries, countriesLoading],
  )
  const doc = useOfferDocument(input)
  const preview = useRef<OfferPreviewHandle>(null)
  const view = useClientViewOffer()
  const [error, setError] = useState<string | null>(null)
  const accept = useClientAcceptOffer((key) => setError(t(key)))
  const changes = useClientRequestOfferChanges((key) => setError(t(key)))
  const [asking, setAsking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [comment, setComment] = useState('')
  const recorded = useRef<string | null>(null)

  // Record the first view of what is published, once per visit.
  useEffect(() => {
    if (!offer || recorded.current === offer.id) return
    if (offer.status !== 'published') return
    recorded.current = offer.id
    view.mutate(offer.id)
  }, [offer, view])

  if (isLoading) return <Spinner />
  if (!offer) {
    return (
      <Card className="p-5">
        <EmptyState title={t('offers.print.missing')} hint={t('offers.portal.missingHint')} />
      </Card>
    )
  }
  const status = offer.effective_status

  return (
    <div>
      <Link to="/portal/offers" className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        {t('offers.portal.back')}
      </Link>
      <PageHeader
        title={offer.offer_number}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(status)}>{t(`offers.statuses.${status}`)}</Badge>
            {t('offers.validUntil', { date: formatDate(offer.valid_until, locale) })}
          </span>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {offer.data && (
              <>
                <span className="text-[0.7812rem] text-slate-500">{t('offers.pdfHint')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!doc}
                  onClick={() => void printOfferFrame(preview.current?.frame ?? null).catch(() => setError(t('offers.errors.printFailed')))}
                >
                  <Download className="size-4" />
                  {t('offers.actions.downloadPdf')}
                </Button>
              </>
            )}
            {clientCanRequestChanges(status) && (
              <Button size="sm" variant="secondary" onClick={() => setAsking(true)} loading={changes.isPending}>
                {t('offers.portal.requestChanges')}
              </Button>
            )}
            {clientCanRequestChanges(status) && (
              <Button
                size="sm"
                onClick={() => setConfirming(true)}
                loading={accept.isPending}
                disabled={!clientCanAccept(status)}
                title={clientCanAccept(status) ? undefined : t('offers.portal.expiredHint')}
              >
                {t('offers.portal.accept')}
              </Button>
            )}
          </span>
        }
      />

      {error && <Callout tone="neg" title={error} className="mb-4" />}
      {status === 'expired' && (
        <Callout tone="warn" title={t('offers.portal.expiredTitle')} className="mb-4">
          {t('offers.portal.expiredHint')}
        </Callout>
      )}
      {status === 'accepted' && <Callout tone="pos" title={t('offers.portal.acceptedTitle')} className="mb-4" />}
      {status === 'changes_requested' && (
        <Callout tone="info" title={t('offers.portal.changesTitle')} className="mb-4">
          {offer.client_comment && <>«{offer.client_comment}»</>}
        </Callout>
      )}
      {status === 'withdrawn' && <Callout tone="warn" title={t('offers.portal.withdrawnTitle')} className="mb-4" />}

      {offer.data ? (
        <OfferPreview ref={preview} doc={doc} height="calc(100vh - 15rem)" />
      ) : (
        <Card className="p-5">
          <EmptyState title={t('offers.portal.noContent')} hint={t('offers.portal.noContentHint')} />
        </Card>
      )}

      {confirming && (
        <Modal
          open
          title={t('offers.portal.acceptTitle', { number: offer.offer_number })}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setError(null)
                  setConfirming(false)
                  accept.mutate({ offerId: offer.id })
                }}
              >
                {t('offers.portal.acceptConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{t('offers.portal.acceptBody')}</p>
        </Modal>
      )}

      {asking && (
        <Modal
          open
          title={t('offers.portal.requestChanges')}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={!comment.trim()}
                title={comment.trim() ? undefined : t('offers.portal.commentRequired')}
                onClick={() => {
                  setError(null)
                  setAsking(false)
                  changes.mutate({ offerId: offer.id, comment: comment.trim() })
                  setComment('')
                }}
              >
                {t('offers.portal.sendChanges')}
              </Button>
            </>
          }
        >
          <Field label={t('offers.portal.commentLabel')} hint={t('offers.portal.commentHint')}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  )
}
