/** «Коммерческое предложение» on a submission (migration 0058): the live
 *  offer's versions — which one the client sees, which are superseded, and
 *  the newest not yet published — with the actions on each: view (the offer
 *  screen, read-only for an earlier version), edit the parameters (the
 *  newest, while the offer is live), publish, download PDF (the same
 *  renderer as the preview, printed from a hidden frame), withdraw. A
 *  prospect nobody can sign in for yet gets a hint on how a portal user is
 *  created today. Earlier offers (accepted, declined, withdrawn) are listed
 *  below the current one. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, Pencil } from 'lucide-react'

import {
  ActionsMenu,
  actionsCol,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  RowActions,
  SectionTitle,
  Table,
  Truncate,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatDate, formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useStaffDirectory } from '../data/api'
import { countriesQuery } from '../entities/api'
import { offerVersionQuery, useOfferVersions, usePublishOffer, useRequestOffers } from './api'
import type { OfferVersionMeta } from './api'
import { staffRenderInput } from './kp/input'
import {
  canEdit,
  canPublishOffers,
  canWriteOffers,
  isLive,
  publishBlocker,
  requestAllowsOffer,
  statusTone,
  versionState,
} from './machine'
import type { OfferRow } from './model'
import { CreateOfferModal, WithdrawOfferModal } from './modals'
import { offerEditPath } from './paths'
import { useOfferPrinter } from './useOfferPrinter'

const VERSION_STATE_COL = labelCol('offerVersionState')
const ACTIONS_COL = actionsCol([], 3)

function IconLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent-500 [&_svg]:size-4"
    >
      {children}
    </Link>
  )
}

/** Keeps a button's place in the row when it is not offered there. */
const Slot = () => <span className="inline-block size-8" aria-hidden />

interface OfferSectionProps {
  requestId: string
  requestStatus: string
  entityId: string
  /** A submission without terms cannot have an offer yet. */
  termsReady: boolean
}

export function OfferSection({ requestId, requestStatus, entityId, termsReady }: OfferSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { roles } = useAuth()
  const { data: offers, isLoading } = useRequestOffers(requestId)
  const live = offers?.find((o) => isLive(o.status)) ?? null
  const shown = live ?? offers?.[0] ?? null
  const earlier = (offers ?? []).filter((o) => o.id !== shown?.id)
  const { data: versions } = useOfferVersions(shown?.id)
  const { data: staff } = useStaffDirectory()
  const publish = usePublishOffer()
  const [creating, setCreating] = useState(false)
  const [withdrawing, setWithdrawing] = useState<OfferRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const printer = useOfferPrinter(() => setError(t('offers.errors.printFailed')))
  const downloadPdf = (offer: OfferRow, versionNo: number) =>
    printer.print(async () => {
      const [version, countries] = await Promise.all([
        qc.fetchQuery(offerVersionQuery(offer.id, versionNo)),
        qc.fetchQuery(countriesQuery),
      ])
      return version ? staffRenderInput(offer, version, countries) : null
    })

  const writer = canWriteOffers(roles)
  const publisher = canPublishOffers(roles)
  const latest = versions?.[0] ?? null
  const blocker = shown ? publishBlocker(shown, latest?.valid_until ?? null) : null
  const person = (id: string) => {
    const m = staff?.get(id)
    return m ? m.full_name?.trim() || m.email : EM_DASH
  }

  const doPublish = (offer: OfferRow) => {
    setError(null)
    publish.mutate(offer, { onError: (e) => setError(t(refusalKey(e))) })
  }

  const canCreate = writer && !live && requestAllowsOffer(requestStatus)

  return (
    <Card className="p-5">
      <SectionTitle
        className="mb-3"
        hint={
          shown ? (
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-small text-slate-600">{shown.offer_number}</span>
              <Badge tone={statusTone(shown.effective_status)}>{t(`offers.statuses.${shown.effective_status}`)}</Badge>
              <span className="text-small text-slate-500">
                {t('offers.validUntil', { date: formatDate(shown.valid_until, locale) })}
              </span>
            </span>
          ) : undefined
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {shown && live && publisher && (
              <Button
                size="sm"
                onClick={() => doPublish(shown)}
                loading={publish.isPending}
                disabled={blocker !== null}
                title={blocker ? t(`offers.publishBlockers.${blocker}`) : t('offers.actions.publishHint')}
              >
                {shown.published_version_no ? t('offers.actions.republish') : t('offers.actions.publish')}
              </Button>
            )}
            {canCreate && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCreating(true)}
                disabled={!termsReady}
                title={termsReady ? undefined : t('offers.createBlockedTerms')}
              >
                {t('offers.actions.create')}
              </Button>
            )}
          </span>
        }
      >
        {t('offers.title')}
      </SectionTitle>

      {error && <Callout tone="neg" title={error} className="mb-3" />}

      {shown && shown.is_prospect && !shown.has_portal_users && (
        <Callout tone="warn" title={t('offers.prospectHint.title')} className="mb-3">
          {t('offers.prospectHint.body')}
        </Callout>
      )}
      {shown?.status === 'changes_requested' && shown.client_comment && (
        <Callout tone="warn" title={t('offers.clientAskedChanges')} className="mb-3">
          «{shown.client_comment}»
        </Callout>
      )}

      {isLoading ? null : !shown ? (
        <EmptyState
          title={t('offers.empty')}
          hint={requestAllowsOffer(requestStatus) ? t('offers.emptyHint') : t('offers.emptyHintStep')}
        />
      ) : (
        <Table dense fillMin="8rem" columns={['4.5rem', VERSION_STATE_COL, COL.moment, COL.date, '9.5rem', COL.fill, ACTIONS_COL]}>
          <thead>
            <tr>
              <th>{t('offers.columns.version')}</th>
              <th>{t('offers.columns.state')}</th>
              <th>{t('offers.columns.saved')}</th>
              <th>{t('offers.columns.validUntil')}</th>
              <th>{t('offers.columns.author')}</th>
              <th>{t('offers.columns.note')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(versions ?? []).map((v: OfferVersionMeta, i) => {
              const state = versionState(v.version_no, shown.published_version_no)
              const newest = i === 0
              const editable = writer && newest && canEdit(shown)
              // The row opens the version, as «view» does.
              return (
                <LinkRow key={v.id} to={offerEditPath(shown.id, newest ? null : v.version_no)}>
                  <td className="tabular-nums">
                    <span className={newest ? 'font-semibold text-slate-900' : 'text-slate-600'}>v{v.version_no}</span>
                  </td>
                  <td>
                    <Badge tone={state === 'published' ? statusTone(shown.effective_status) : 'neutral'}>
                      {state === 'published'
                        ? t(`offers.statuses.${shown.effective_status}`)
                        : t(`offers.versionStates.${state}`)}
                    </Badge>
                  </td>
                  <td className="tabular-nums">{formatMoment(v.created_at, locale)}</td>
                  <td className="tabular-nums">{formatDate(v.valid_until, locale)}</td>
                  <td>
                    <Truncate text={person(v.author_id)} className="max-w-none">
                      {person(v.author_id)}
                    </Truncate>
                  </td>
                  <td>
                    <Truncate text={v.note ?? ''} className="max-w-none">
                      {v.note ?? <span className="text-slate-500">{EM_DASH}</span>}
                    </Truncate>
                  </td>
                  <RowActions>
                    <span className="flex items-center gap-1">
                      <IconLink to={offerEditPath(shown.id, newest ? null : v.version_no)} label={t('offers.actions.view')}>
                        <Eye />
                      </IconLink>
                      {editable ? (
                        <IconLink to={offerEditPath(shown.id)} label={t('offers.actions.edit')}>
                          <Pencil />
                        </IconLink>
                      ) : (
                        <Slot />
                      )}
                      <ActionsMenu
                        size="sm"
                        trigger="icon"
                        label={t('offers.actions.more')}
                        actions={[
                          {
                            key: 'pdf',
                            label: t('offers.actions.downloadPdf'),
                            onSelect: () => downloadPdf(shown, v.version_no),
                          },
                          ...(newest && publisher && isLive(shown.status)
                            ? [
                                {
                                  key: 'withdraw',
                                  label: t('offers.actions.withdraw'),
                                  onSelect: () => setWithdrawing(shown),
                                  danger: true,
                                },
                              ]
                            : []),
                        ]}
                      />
                    </span>
                  </RowActions>
                </LinkRow>
              )
            })}
          </tbody>
        </Table>
      )}

      {earlier.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-caption font-semibold tracking-wide text-slate-500 uppercase">{t('offers.earlier')}</p>
          <ul className="flex flex-col gap-1 text-small">
            {earlier.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <Link to={offerEditPath(o.id, o.published_version_no ?? o.current_version_no)} className="font-mono text-accent-600 hover:underline">
                  {o.offer_number}
                </Link>
                <Badge tone={statusTone(o.effective_status)}>{t(`offers.statuses.${o.effective_status}`)}</Badge>
                <span className="text-slate-500">{formatMoment(o.updated_at, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <CreateOfferModal
          requestId={requestId}
          entityId={entityId}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            navigate(offerEditPath(id))
          }}
        />
      )}
      {withdrawing && <WithdrawOfferModal offer={withdrawing} onClose={() => setWithdrawing(null)} />}
      {printer.frame}
    </Card>
  )
}
