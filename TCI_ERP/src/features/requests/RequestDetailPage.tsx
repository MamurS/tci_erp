/** Submission page: status + allowed transitions, entity resolution, the
 * proposed terms, the buyer package with its credit/commercial/effective
 * columns, the sales window panel, and the transition history. */

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH } from '../../lib/format'
import {
  useAdvanceInsuranceRequest,
  useInsuranceRequest,
  useRequestBuyers,
  useRequestCreditCoverage,
} from './api'
import { BuyerPackageTable } from './BuyerPackageTable'
import { EntityResolutionSection } from './EntityResolutionSection'
import { ProposedTermsSection } from './ProposedTermsSection'
import { RequestHistoryTimeline } from './RequestHistoryTimeline'
import { SalesWindowPanel } from './SalesWindowPanel'
import {
  creditComplete,
  entitiesResolved,
  owningRole,
  statusTone,
  transitionOffers,
} from './machine'
import type { InsuranceRequestStatus } from './types'

export function RequestDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { session, roles } = useAuth()

  const { data: request, isLoading } = useInsuranceRequest(id)
  const { data: buyers } = useRequestBuyers(id)
  const { data: creditCoverage } = useRequestCreditCoverage(id)
  const advance = useAdvanceInsuranceRequest()

  const [pending, setPending] = useState<InsuranceRequestStatus | null>(null)
  const [comment, setComment] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const facts = useMemo(
    () => ({
      entitiesResolved: entitiesResolved(buyers ?? []),
      creditComplete: creditComplete(buyers ?? [], creditCoverage ?? new Set<string>()),
    }),
    [buyers, creditCoverage],
  )

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!request) {
    return (
      <EmptyState
        title={t('requests.notFound')}
        action={
          <Link to="/requests" className="text-sm font-medium text-accent-700 hover:underline">
            {t('requests.backToQueue')}
          </Link>
        }
      />
    )
  }

  const isCreator = request.created_by === session?.user.id
  const offers = transitionOffers(request.status, roles, isCreator, facts)
  const visibleOffers = offers.filter((o) => o.allowedByRole)
  // A decline always needs its reason, so it opens the comment modal too.
  const needsComment = (to: InsuranceRequestStatus) => to === 'declined' || to === 'withdrawn'

  const runTransition = async (to: InsuranceRequestStatus, withComment: string | null) => {
    setActionError(null)
    try {
      await advance.mutateAsync({ requestId: request.id, to, comment: withComment })
      setPending(null)
      setComment('')
    } catch {
      setActionError(t('requests.transitionFailed'))
    }
  }

  const owner = owningRole(request.status)

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className="num">{request.request_number}</span>
            <Badge tone={statusTone(request.status)} size="lg">
              {t(`requests.statuses.${request.status}`)}
            </Badge>
          </span>
        }
        subtitle={
          <span>
            <Link to="/requests" className="text-accent-700 hover:underline">
              {t('nav.requests')}
            </Link>
            {' / '}
            <Link to={`/entities/${request.entity_id}`} className="text-accent-700 hover:underline">
              {request.legal_entities?.name ?? EM_DASH}
            </Link>
            {owner && (
              <>
                {' · '}
                {t('requests.waitingOn', { role: t(`roles.${owner}`) })}
              </>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {visibleOffers.map((offer) => (
              <Button
                key={offer.to}
                variant={
                  offer.to === 'withdrawn' || offer.to === 'declined' ? 'ghost' : 'primary'
                }
                disabled={advance.isPending || offer.guard !== null}
                title={offer.guard ? t(`requests.guards.${offer.guard}`) : undefined}
                onClick={() => {
                  if (needsComment(offer.to)) {
                    setPending(offer.to)
                    setComment('')
                  } else {
                    void runTransition(offer.to, null)
                  }
                }}
              >
                {t(`requests.transitions.${offer.to}`)}
              </Button>
            ))}
          </div>
        }
      />

      {/* Why an otherwise-allowed transition is disabled. */}
      {visibleOffers
        .filter((o) => o.guard)
        .map((o) => (
          <div
            key={o.to}
            className="mb-3 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500"
          >
            {t(`requests.guards.${o.guard}`)}
          </div>
        ))}

      {actionError && (
        <div
          className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500"
          role="alert"
        >
          {actionError}
        </div>
      )}

      {request.decline_reason && (
        <Card className="mb-4 border-neg-500/30 bg-neg-50 p-4 text-[13px] text-neg-500">
          <span className="font-medium">{t('requests.fields.declineReason')}: </span>
          {request.decline_reason}
        </Card>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <EntityResolutionSection request={request} buyers={buyers ?? []} />
          <BuyerPackageTable request={request} buyers={buyers ?? []} />
          {request.status === 'sales_confirmation' && <SalesWindowPanel request={request} />}
        </div>
        <div className="flex flex-col gap-5">
          <ProposedTermsSection request={request} />
          <RequestHistoryTimeline requestId={request.id} notes={request.notes} />
        </div>
      </div>

      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title={t(`requests.transitions.${pending}`)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={advance.isPending || (pending === 'declined' && !comment.trim())}
                onClick={() => void runTransition(pending, comment.trim() || null)}
              >
                {t('common.confirm')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            {t(`requests.confirm.${pending}`)}
          </p>
          <Field
            label={
              pending === 'declined'
                ? t('requests.fields.declineReason')
                : t('policies.transitionComment')
            }
          >
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
