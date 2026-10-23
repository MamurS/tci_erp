/** Submission page: status + allowed transitions, entity resolution, the
 * proposed terms, the buyer package with its credit/commercial/effective
 * columns, the sales window panel, and the transition history. */

import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Callout, EmptyState, Field, LinkButton, Modal, PageHeader, PanelGrid, Spinner, Textarea } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH } from '../../lib/format'
import { pickParam } from '../../lib/deepLink'
import { DEEP_LINK_SCROLL_MARGIN, useDeepLinkFocus } from '../../lib/useDeepLinkFocus'
import {
  useAdvanceInsuranceRequest,
  useInsuranceRequest,
  useRequestBuyers,
  useRequestCreditCoverage,
} from './api'
import { BindPolicyModal } from './BindPolicyModal'
import { BuyerPackageTable } from './BuyerPackageTable'
import { EntityResolutionSection } from './EntityResolutionSection'
import { ProposedTermsSection } from './ProposedTermsSection'
import { RequestHistoryTimeline } from './RequestHistoryTimeline'
import { SalesWindowPanel } from './SalesWindowPanel'
import { DraftContractSection } from '../wording'
import { OfferSection } from '../offers/OfferSection'
import { bindBlocker, canBindAs } from './bind'
import {
  creditComplete,
  entitiesResolved,
  owningRole,
  statusTone,
  transitionOffers,
} from './machine'
import type { InsuranceRequestStatus } from './types'

/** The sections `?focus=` may name; each is the `id` of its wrapper. */
const REQUEST_FOCUS_TARGETS = ['sales-window', 'buyers', 'offer'] as const

export function RequestDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { session, roles } = useAuth()

  const { data: request, isLoading } = useInsuranceRequest(id)
  const { data: buyers } = useRequestBuyers(id)
  const { data: creditCoverage } = useRequestCreditCoverage(id)
  const advance = useAdvanceInsuranceRequest()

  const [pending, setPending] = useState<InsuranceRequestStatus | null>(null)
  const [binding, setBinding] = useState(false)
  const [comment, setComment] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  // ?focus=sales-window|buyers (the Agenda's links) lands on that section once
  // the buyers are in — the resolution section above them depends on them and
  // would otherwise push the target down after the scroll. With
  // &decision=<id> the sales window is scrolled to and that decision's row is
  // the one ringed; nothing is opened (holding stays a deliberate click).
  const [searchParams] = useSearchParams()
  const named = pickParam(searchParams.get('focus'), REQUEST_FOCUS_TARGETS)
  const decisionId = named !== 'buyers' ? searchParams.get('decision') : null
  // A decision lives in the sales window, so naming one implies it.
  const focus = named ?? (decisionId ? 'sales-window' : null)
  useDeepLinkFocus(focus, { ready: buyers !== undefined, highlight: !decisionId })
  useDeepLinkFocus(decisionId ? `decision-${decisionId}` : null, {
    ready: buyers !== undefined,
    scroll: false,
  })

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
          <LinkButton to="/requests" variant="secondary">
            {t('requests.backToQueue')}
          </LinkButton>
        }
      />
    )
  }

  const isCreator = request.created_by === session?.user.id
  const offers = transitionOffers(request.status, roles, isCreator, facts)
  const visibleOffers = offers.filter((o) => o.allowedByRole)
  // Moves first, the destructive ones (decline, withdraw) last and in red.
  const isDestructive = (to: InsuranceRequestStatus) => to === 'withdrawn' || to === 'declined'
  const orderedOffers = [
    ...visibleOffers.filter((o) => !isDestructive(o.to)),
    ...visibleOffers.filter((o) => isDestructive(o.to)),
  ]
  // Why a move cannot be made yet — said right under its button.
  const guardReasons = [...new Set(visibleOffers.flatMap((o) => (o.guard ? [o.guard] : [])))]
  // A decline always needs its reason, so it opens the comment modal too.
  const needsComment = (to: InsuranceRequestStatus) => to === 'declined' || to === 'withdrawn'

  const runTransition = async (to: InsuranceRequestStatus, withComment: string | null) => {
    setActionError(null)
    // The status paints at once (optimistic, api.ts); a confirmation closes
    // at once too and reopens, comment kept, if the database refuses.
    setPending(null)
    try {
      await advance.mutateAsync({ requestId: request.id, to, comment: withComment })
      setComment('')
    } catch (failure) {
      setActionError(t(refusalOr(failure, 'requests.transitionFailed')))
      if (needsComment(to)) setPending(to)
    }
  }

  const owner = owningRole(request.status)

  return (
    <div>
      <PageHeader
        title={<span className="num">{request.request_number}</span>}
        status={<Badge tone={statusTone(request.status)}>{t(`requests.statuses.${request.status}`)}</Badge>}
        subtitle={
          <span>
            <Link to="/requests" className="text-accent-700 hover:underline">
              {t('nav.requests')}
            </Link>
            {' / '}
            <Link to={`/entities/${request.entity_id}`} className="text-accent-700 hover:underline">
              {request.legal_entities?.name ?? EM_DASH}
            </Link>
            {request.bound_policy_id && (
              <>
                {' · '}
                <Link
                  to={`/policies/${request.bound_policy_id}`}
                  className="text-accent-700 hover:underline"
                >
                  {t('requests.bind.boundPolicyLink')}
                </Link>
              </>
            )}
            {owner && (
              <>
                {' · '}
                {t('requests.waitingOn', { role: t(`roles.${owner}`) })}
              </>
            )}
          </span>
        }
        actions={
          <div className="flex max-w-md flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canBindAs(roles) && bindBlocker(request) === null && (
                <Button onClick={() => setBinding(true)}>{t('requests.bind.action')}</Button>
              )}
              {orderedOffers.map((offer) => (
                // A disabled button shows no tooltip of its own; the wrapper does.
                <span
                  key={offer.to}
                  className="inline-flex"
                  title={offer.guard ? t(`requests.guards.${offer.guard}`) : undefined}
                >
                  <Button
                    variant={isDestructive(offer.to) ? 'dangerOutline' : 'primary'}
                    disabled={advance.isPending || offer.guard !== null}
                    loading={advance.isPending && advance.variables?.to === offer.to}
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
                </span>
              ))}
            </div>
            {guardReasons.map((guard) => (
              <p key={guard} className="text-right text-[12px] leading-snug text-warn-500">
                {t(`requests.guards.${guard}`)}
              </p>
            ))}
          </div>
        }
      />

      {(actionError || request.decline_reason) && (
        <div className="mb-5 flex flex-col gap-3">
          {actionError && <Callout tone="neg" title={actionError} />}
          {request.decline_reason && (
            <Callout tone="neg" title={t('requests.fields.declineReason')}>
              {request.decline_reason}
            </Callout>
          )}
        </div>
      )}

      {/* The buyers and their limits are what a submission is about: they
          take the page's full width (five columns never fit in a side
          column). The terms, the contract and the history follow, side by
          side. */}
      <div className="flex flex-col gap-5">
        <EntityResolutionSection request={request} buyers={buyers ?? []} />
        {/* The wrappers carry the ?focus= targets and have no look of their own. */}
        <div id="buyers" className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
          <BuyerPackageTable request={request} buyers={buyers ?? []} />
        </div>
        {request.status === 'sales_confirmation' && (
          <div id="sales-window" className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
            <SalesWindowPanel request={request} />
          </div>
        )}
        <PanelGrid cols="xl:grid-cols-2">
          <ProposedTermsSection request={request} />
          <RequestHistoryTimeline requestId={request.id} notes={request.notes} />
        </PanelGrid>
        {/* The commercial offer published to the client (0058). */}
        <div id="offer" className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
          <OfferSection
            requestId={request.id}
            requestStatus={request.status}
            entityId={request.entity_id}
            termsReady={Boolean(
              request.product_structure && request.currency_code && request.premium_rate_pct !== null &&
                request.minimum_premium !== null,
            )}
          />
        </div>
        {/* The contract draft's versions table needs the full width (0057). */}
        <DraftContractSection
          target={{ requestId: request.id }}
          reference={request.request_number}
          countryCode={request.legal_entities?.country_code ?? null}
          product={request.product_structure}
        />
      </div>

      {binding && (
        <BindPolicyModal request={request} open onClose={() => setBinding(false)} />
      )}

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
                disabled={pending === 'declined' && !comment.trim()}
                loading={advance.isPending}
                title={pending === 'declined' && !comment.trim() ? t('requests.guards.declineNeedsReason') : undefined}
                onClick={() => void runTransition(pending, comment.trim() || null)}
              >
                {t(`requests.transitions.${pending}`)}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{t(`requests.confirm.${pending}`)}</p>
          <Field
            label={
              pending === 'declined'
                ? `${t('requests.fields.declineReason')} *`
                : t('policies.transitionComment')
            }
          >
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
