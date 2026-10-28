/** The policyholder's claims: what can be claimed, what has been filed, and
 * what the insurer decided. Every read is a tci.v_client_* view and every
 * write a tci.client_* function — nothing here touches a base table. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  ActionsMenu,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  Field,
  LinkButton,
  Input,
  labelCol,
  Modal,
  PageHeader,
  RowActions,
  SectionTitle,
  Select,
  Spinner,
  Table,
  Textarea,
  Truncate,
} from '../../components/ui'
import { claimErrorKey } from '../claims/errors'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { EM_DASH, formatAmount, formatDate, formatMoment } from '../../lib/format'
import { searchRows } from '../../lib/pageSearch'
import {
  useClientOpenClaim,
  useClientRespondToInfoRequest,
  useClientSubmitClaim,
  useClientWithdrawClaim,
  useMyClaimable,
  useMyClaims,
} from './api'
import { PortalClaimDetail } from './PortalClaimDetail'
import { PortalNoMatches, PortalSearch } from './PortalSearch'
import type { ClientClaim, ClientClaimable } from './types'

const TONE: Record<ClientClaim['status'], 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'> = {
  draft: 'neutral',
  submitted: 'accent',
  under_assessment: 'accent',
  info_requested: 'warn',
  approved: 'pos',
  partially_approved: 'warn',
  declined: 'neg',
  paid: 'pos',
  closed: 'neutral',
  withdrawn: 'neutral',
}

export function PortalClaimsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: claims, isLoading } = useMyClaims()
  const { data: claimable } = useMyClaimable()
  const [open, setOpen] = useState<string | null>(null)
  const [filing, setFiling] = useState<ClientClaimable | null>(null)
  const [responding, setResponding] = useState<ClientClaim | null>(null)
  const [withdrawing, setWithdrawing] = useState<ClientClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = useClientSubmitClaim()
  const withdraw = useClientWithdrawClaim()
  // The page search (PortalSearch): number, buyer, policy, amount, status.
  const { query, setQuery } = usePageSearch('portal-claims')

  if (isLoading) return <Spinner label={t('common.loading')} />

  const allReady = (claimable ?? []).filter((c) => !c.claim_exists)
  const ready = searchRows(allReady, query, (c) => [
    c.buyer_name,
    c.policy_number,
    c.overdue_amount,
    formatAmount(Number(c.overdue_amount), locale),
    c.currency_code,
  ])
  const allClaims = claims ?? []
  const shownClaims = searchRows(allClaims, query, (c) => [
    c.claim_number,
    c.buyer_name,
    c.policy_number,
    c.claimed_amount,
    formatAmount(Number(c.claimed_amount), locale),
    c.currency_code,
    t(`claims.statuses.${c.status}`),
  ])
  const openClaim = (claims ?? []).find((c) => c.id === open) ?? null

  function fail(e: unknown) {
    const k = claimErrorKey(e)
    setError(k ? t(k) : t('common.somethingWentWrong'))
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('portal.claims.title')} subtitle={t('portal.claims.subtitle')} />

      {allReady.length + allClaims.length > 0 && (
        <PortalSearch query={query} onChange={setQuery} placeholder={t('portal.search.claims')} />
      )}

      {error && <Callout tone="neg" title={error} />}

      {/* Nothing to claim yet: say where a claim comes from, whether or not
          there are claims below (the empty state alone said it only once). */}
      {allReady.length === 0 && (
        <Callout
          tone="info"
          title={t('portal.claims.howTo.title')}
          action={
            <LinkButton to="/portal/overdues" variant="secondary" size="sm">
              {t('portal.claims.howTo.action')}
            </LinkButton>
          }
        >
          {t('portal.claims.howTo.body')}
        </Callout>
      )}

      {ready.length > 0 && (
        <Card className="p-5">
          <SectionTitle className="mb-3" hint={t('portal.claims.claimableHint')}>
            {t('portal.claims.claimableTitle')}
          </SectionTitle>
          <Table columns={[COL.fill, COL.code, COL.money, '15rem', actionsCol(['fileClaim'])]}>
            <thead>
              <tr>
                <th>{t('portal.claims.fields.buyer')}</th>
                <th>{t('portal.claims.fields.policy')}</th>
                <th className="num">{t('portal.claims.fields.overdueAmount')}</th>
                <th>{t('portal.claims.fields.claimableFrom')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ready.map((c) => (
                <tr key={c.noa_id}>
                  <td>
                    <Truncate text={c.buyer_name} className="max-w-none" />
                  </td>
                  <td className="whitespace-nowrap text-slate-600 tabular-nums">{c.policy_number}</td>
                  <td className="num">
                    {formatAmount(Number(c.overdue_amount), locale)} {c.currency_code}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDate(c.claimable_from, locale)}
                    {!c.claimable_now && (
                      <span className="ml-2">
                        <Badge tone="warn">{t('portal.claims.waiting')}</Badge>
                      </span>
                    )}
                  </td>
                  <RowActions>
                    <Button size="sm" disabled={!c.claimable_now} onClick={() => setFiling(c)}>
                      {t('portal.claims.actions.file')}
                    </Button>
                  </RowActions>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle className="mb-3">{t('portal.claims.listTitle')}</SectionTitle>
        {allClaims.length === 0 ? (
          <EmptyState title={t('portal.claims.emptyTitle')} hint={t('portal.claims.emptyHint')} />
        ) : shownClaims.length === 0 ? (
          <PortalNoMatches onClear={() => setQuery('')} />
        ) : (
          <Table columns={[COL.code, COL.fill, COL.money, COL.money, labelCol('claimStatus'), actionsCol(['claimNextStep'], 1)]}>
            <thead>
              <tr>
                <th>{t('portal.claims.fields.number')}</th>
                <th>{t('portal.claims.fields.buyer')}</th>
                <th className="num">{t('portal.claims.fields.claimed')}</th>
                <th className="num">{t('portal.claims.fields.indemnity')}</th>
                <th>{t('portal.claims.fields.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownClaims.map((c) => (
                // The whole row opens the claim below, like every register in
                // the application; the buttons in it stop the click.
                <tr
                  key={c.id}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  aria-selected={open === c.id}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                    open === c.id ? 'bg-accent-50' : ''
                  }`}
                >
                  <td className="whitespace-nowrap font-medium text-accent-700 tabular-nums">{c.claim_number}</td>
                  <td>
                    <Truncate text={c.buyer_name} className="max-w-none" />
                  </td>
                  <td className="num">
                    {formatAmount(Number(c.claimed_amount), locale)} {c.currency_code}
                  </td>
                  <td className="num">
                    {c.approved_indemnity === null
                      ? EM_DASH
                      : `${formatAmount(Number(c.approved_indemnity), locale)} ${c.currency_code}`}
                  </td>
                  <td>
                    <Badge tone={TONE[c.status]}>{t(`claims.statuses.${c.status}`)}</Badge>
                  </td>
                  <RowActions>
                    {c.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          loading={submit.isPending && submit.variables === c.id}
                          onClick={() => submit.mutateAsync(c.id).catch(fail)}
                        >
                          {t('portal.claims.actions.submit')}
                        </Button>
                        {/* The withdrawal folds into ⋯ (it ends the claim, so it
                            sits apart, in red): two buttons side by side did
                            not fit the row on a laptop. */}
                        <ActionsMenu
                          trigger="icon"
                          size="sm"
                          actions={[
                            {
                              key: 'withdraw',
                              label: t('portal.claims.actions.withdraw'),
                              danger: true,
                              onSelect: () => setWithdrawing(c),
                            },
                          ]}
                        />
                      </>
                    )}
                    {c.status === 'info_requested' && (
                      <Button size="sm" onClick={() => setResponding(c)}>
                        {t('portal.claims.actions.respond')}
                      </Button>
                    )}
                  </RowActions>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {openClaim && (
        <section>
          <SectionTitle className="mb-3">
            {openClaim.claim_number} · {openClaim.buyer_name}
          </SectionTitle>
          <PortalClaimDetail claim={openClaim} />
        </section>
      )}

      {filing && <FileClaimModal source={filing} onClose={() => setFiling(null)} onError={fail} />}
      {responding && (
        <RespondModal claim={responding} onClose={() => setResponding(null)} onError={fail} />
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        title={t('claims.actions.withdrawn')}
        message={t('portal.claims.withdrawConfirm', { number: withdrawing?.claim_number ?? '' })}
        confirmLabel={t('claims.actions.withdrawn')}
        pending={withdraw.isPending}
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => {
          if (!withdrawing) return
          // The claim reads «withdrawn» at once (optimistic): close now.
          setWithdrawing(null)
          void withdraw.mutateAsync({ claim_id: withdrawing.id }).catch(fail)
        }}
      />

      {(claims ?? []).some((c) => c.decision_reason && c.status === 'declined') && (
        <p className="text-caption text-slate-500">
          {t('portal.claims.declinedNote', { at: formatMoment(new Date(), locale) })}
        </p>
      )}
    </div>
  )
}

function FileClaimModal({
  source,
  onClose,
  onError,
}: {
  source: ClientClaimable
  onClose: () => void
  onError: (e: unknown) => void
}) {
  const { t, i18n } = useTranslation()
  const openClaim = useClientOpenClaim()
  const [cause, setCause] = useState<'protracted_default' | 'insolvency' | 'other'>(
    'protracted_default',
  )
  const [reference, setReference] = useState('')

  return (
    <Modal
      open
      title={t('portal.claims.file.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={openClaim.isPending}
            onClick={() =>
              openClaim
                .mutateAsync({
                  policy_id: source.policy_id,
                  entity_id: source.buyer_id,
                  cause_of_loss: cause,
                  overdue_notification_id: source.noa_id,
                  insolvency_reference: reference || null,
                })
                .then(onClose)
                .catch(onError)
            }
          >
            {t('portal.claims.actions.create')}
          </Button>
        </>
      }
    >
      {/* The buyer is named here, not in the title: a company name in an
          uppercase title wraps onto two lines. */}
      <DescriptionList
        items={[
          { label: t('portal.claims.fields.buyer'), value: source.buyer_name },
          { label: t('portal.claims.fields.policy'), value: source.policy_number },
          {
            label: t('portal.claims.fields.overdueAmount'),
            value: `${formatAmount(Number(source.overdue_amount), i18n.language)} ${source.currency_code}`,
          },
        ]}
      />
      <p className="text-small leading-relaxed text-slate-600">{t('portal.claims.file.hint')}</p>
      <Field label={t('portal.claims.fields.cause')}>
        <Select
          value={cause}
          onChange={(e) =>
            setCause(e.target.value as 'protracted_default' | 'insolvency' | 'other')
          }
        >
          <option value="protracted_default">{t('claims.causes.protracted_default')}</option>
          <option value="insolvency">{t('claims.causes.insolvency')}</option>
          <option value="other">{t('claims.causes.other')}</option>
        </Select>
      </Field>
      {cause === 'insolvency' && (
        <Field label={t('portal.claims.fields.insolvencyReference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}

function RespondModal({
  claim,
  onClose,
  onError,
}: {
  claim: ClientClaim
  onClose: () => void
  onError: (e: unknown) => void
}) {
  const { t } = useTranslation()
  const respond = useClientRespondToInfoRequest()
  const [comment, setComment] = useState('')
  return (
    <Modal
      open
      title={t('portal.claims.respond.title', { number: claim.claim_number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={comment.trim() === ''}
            loading={respond.isPending}
            onClick={() =>
              respond
                .mutateAsync({ claim_id: claim.id, comment })
                .then(onClose)
                .catch(onError)
            }
          >
            {t('portal.claims.actions.send')}
          </Button>
        </>
      }
    >
      <p className="text-small leading-relaxed text-slate-600">{t('portal.claims.respond.hint')}</p>
      <Field label={t('portal.claims.fields.message')}>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  )
}
