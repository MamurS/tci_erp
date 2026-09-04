/** «Мои заявки на страхование» — a submission in flight, and the client's
 * three answers when it reaches them.
 *
 * The proposed terms are null in the view until the submission reaches
 * client_review, so "not agreed yet" is a database fact here, not a UI
 * choice. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment, formatPercent } from '../../lib/format'
import {
  useMySubmissionBuyers,
  useMySubmissionHistory,
  useMySubmissions,
  useRespondToSubmission,
} from './api'
import { termsVisible } from './machine'
import type { SubmissionAction } from './api'
import type { ClientSubmission } from './types'

export function PortalSubmissionsPage() {
  const { t, i18n } = useTranslation()
  const { data: submissions, isLoading } = useMySubmissions()
  const [openId, setOpenId] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div>
      <PageHeader
        title={t('portal.submissions.title')}
        subtitle={t('portal.submissions.subtitle')}
      />

      {!submissions?.length ? (
        <EmptyState
          title={t('portal.submissions.empty')}
          hint={t('portal.submissions.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {submissions.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              locale={i18n.language}
              expanded={openId === submission.id}
              onToggle={() =>
                setOpenId(openId === submission.id ? null : submission.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionCard({
  submission,
  locale,
  expanded,
  onToggle,
}: {
  submission: ClientSubmission
  locale: string
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const { data: buyers } = useMySubmissionBuyers(expanded ? submission.id : null)
  const { data: history } = useMySubmissionHistory(expanded ? submission.id : null)
  const [action, setAction] = useState<SubmissionAction | null>(null)

  const withClient = submission.status === 'client_review'
  const showTerms = termsVisible(submission.status)

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-3">
          <span className="num text-base font-semibold text-slate-900">
            {submission.request_number}
          </span>
          <Badge tone={withClient ? 'warn' : 'neutral'}>
            {t(`portal.submissions.statuses.${submission.status}`)}
          </Badge>
        </span>
        <button
          type="button"
          className="text-[13px] font-medium text-accent-700"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? t('portal.hideDetails') : t('portal.showDetails')}
        </button>
      </div>

      {withClient && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-3">
          <span className="flex-1 text-[13px] text-warn-500">
            {t('portal.submissions.awaitingYou')}
          </span>
          <Button size="sm" onClick={() => setAction('accept')}>
            {t('portal.submissions.accept')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAction('request_changes')}>
            {t('portal.submissions.requestChanges')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAction('decline')}>
            {t('portal.submissions.decline')}
          </Button>
        </div>
      )}

      {expanded && (
        <div className="mt-4 grid items-start gap-5 border-t border-slate-100 pt-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {t('portal.submissions.terms')}
            </h3>
            {showTerms ? (
              <Table dense>
                <tbody>
                  <TermRow k="product_structure"
                    v={submission.product_structure
                      ? t(`policies.structures.${submission.product_structure}`)
                      : EM_DASH} />
                  <TermRow k="currency_code" v={submission.currency_code ?? EM_DASH} />
                  <TermRow k="insured_percentage"
                    v={submission.insured_percentage === null
                      ? EM_DASH
                      : formatPercent(submission.insured_percentage / 100, locale)} />
                  <TermRow k="premium_rate_pct"
                    v={submission.premium_rate_pct === null
                      ? EM_DASH
                      : formatPercent(submission.premium_rate_pct / 100, locale, 3)} />
                  <TermRow k="minimum_premium"
                    v={submission.minimum_premium === null
                      ? EM_DASH
                      : `${formatAmount(submission.minimum_premium, locale)} ${submission.currency_code ?? ''}`} />
                  <TermRow k="discretionary_limit"
                    v={submission.discretionary_limit === null
                      ? EM_DASH
                      : `${formatAmount(submission.discretionary_limit, locale)} ${submission.currency_code ?? ''}`} />
                  <TermRow k="nql_amount"
                    v={submission.nql_amount === null
                      ? EM_DASH
                      : `${formatAmount(submission.nql_amount, locale)} ${submission.currency_code ?? ''}`} />
                  <TermRow k="max_payment_terms_days"
                    v={submission.max_payment_terms_days === null
                      ? EM_DASH
                      : String(submission.max_payment_terms_days)} />
                  <TermRow k="declaration_frequency"
                    v={submission.declaration_frequency
                      ? t(`policies.frequencies.${submission.declaration_frequency}`)
                      : EM_DASH} />
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-slate-500">
                {t('portal.submissions.termsNotYet')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {t('portal.submissions.buyers')}
              </h3>
              {!buyers?.length ? (
                <p className="text-[13px] text-slate-500">{t('portal.submissions.noBuyers')}</p>
              ) : (
                <Table dense>
                  <tbody>
                    {buyers.map((b) => (
                      <tr key={b.id}>
                        <td>{b.buyer_name ?? EM_DASH}</td>
                        <td className="num text-right">
                          {formatAmount(b.requested_amount, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {t('portal.submissions.progress')}
              </h3>
              {!history?.length ? (
                <p className="text-[13px] text-slate-500">{t('portal.submissions.noHistory')}</p>
              ) : (
                <ol className="flex flex-col gap-1.5 text-[13px]">
                  {history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3">
                      <span className="text-slate-700">
                        {t(`portal.submissions.statuses.${h.to_status}`)}
                      </span>
                      <span className="text-slate-400">{formatMoment(h.changed_at, locale)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {action && (
        <RespondModal
          submission={submission}
          action={action}
          onClose={() => setAction(null)}
        />
      )}
    </Card>
  )
}

function TermRow({ k, v }: { k: string; v: string }) {
  const { t } = useTranslation()
  return (
    <tr>
      <td className="w-1/2 text-slate-500">{t(`requests.terms.${k}`)}</td>
      <td className="num text-right font-medium text-slate-900">{v}</td>
    </tr>
  )
}

function RespondModal({
  submission,
  action,
  onClose,
}: {
  submission: ClientSubmission
  action: SubmissionAction
  onClose: () => void
}) {
  const { t } = useTranslation()
  const respond = useRespondToSubmission()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const needsComment = action !== 'accept'
  const canSend = !respond.isPending && (!needsComment || comment.trim().length > 0)

  const send = async () => {
    setError(null)
    try {
      await respond.mutateAsync({
        requestId: submission.id,
        action,
        comment: comment.trim() || null,
      })
      onClose()
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      setError(
        code === 'P0001' || code === '42501'
          ? t('portal.submissions.respondRefused')
          : t('portal.submissions.respondFailed'),
      )
    }
  }

  return (
    <Modal
      open
      title={t(`portal.submissions.${action}`)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={action === 'accept' ? 'primary' : 'danger'}
            disabled={!canSend}
            onClick={() => void send()}
          >
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="mb-3 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500"
          role="alert"
        >
          {error}
        </div>
      )}
      <p className="mb-3 text-sm text-slate-600">
        {t(`portal.submissions.confirm.${action}`, { number: submission.request_number })}
      </p>
      {needsComment && (
        <Field
          label={t(
            action === 'decline'
              ? 'portal.submissions.declineReason'
              : 'portal.submissions.changesWanted',
          )}
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
          />
        </Field>
      )}
    </Modal>
  )
}
