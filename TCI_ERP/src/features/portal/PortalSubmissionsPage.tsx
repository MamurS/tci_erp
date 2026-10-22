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
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  Table,
  Textarea,
  Truncate,
} from '../../components/ui'
import type { Fact } from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment, formatPercent, formatRate } from '../../lib/format'
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
  const ccy = submission.currency_code
  const money = (v: number | null) =>
    v === null ? EM_DASH : `${formatAmount(v, locale)}${ccy ? ` ${ccy}` : ''}`
  const term = (key: string, value: string): Fact => ({ label: t(`requests.terms.${key}`), value })
  const terms: Fact[] = [
    term(
      'product_structure',
      submission.product_structure ? t(`policies.structures.${submission.product_structure}`) : EM_DASH,
    ),
    term('currency_code', ccy ?? EM_DASH),
    term(
      'insured_percentage',
      submission.insured_percentage === null ? EM_DASH : formatPercent(submission.insured_percentage / 100, locale),
    ),
    term('premium_rate_pct', formatRate(submission.premium_rate_pct, locale)),
    term('minimum_premium', money(submission.minimum_premium)),
    term('discretionary_limit', money(submission.discretionary_limit)),
    term('nql_amount', money(submission.nql_amount)),
    term(
      'max_payment_terms_days',
      submission.max_payment_terms_days === null
        ? EM_DASH
        : t('portal.days', { count: submission.max_payment_terms_days, value: submission.max_payment_terms_days }),
    ),
    term(
      'declaration_frequency',
      submission.declaration_frequency ? t(`policies.frequencies.${submission.declaration_frequency}`) : EM_DASH,
    ),
  ]

  return (
    <Card className="p-5">
      <SectionTitle
        actions={
          <>
            <Badge tone={withClient ? 'warn' : 'neutral'}>
              {t(`portal.submissions.statuses.${submission.status}`)}
            </Badge>
            <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
              {expanded ? t('portal.hideDetails') : t('portal.showDetails')}
            </Button>
          </>
        }
      >
        {submission.request_number}
      </SectionTitle>

      {withClient && (
        <Callout
          tone="warn"
          className="mt-3"
          title={t('portal.submissions.awaitingYou')}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setAction('accept')}>
                {t('portal.submissions.accept')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAction('request_changes')}>
                {t('portal.submissions.requestChanges')}
              </Button>
              <Button variant="dangerOutline" size="sm" onClick={() => setAction('decline')}>
                {t('portal.submissions.decline')}
              </Button>
            </div>
          }
        />
      )}

      {expanded && (
        <div className="mt-4 grid items-start gap-5 border-t border-slate-100 pt-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {t('portal.submissions.terms')}
            </h3>
            {showTerms ? (
              <DescriptionList items={terms} />
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
                        <td className="cell-fill">
                          <Truncate text={b.buyer_name} className="max-w-none">
                            {b.buyer_name ?? EM_DASH}
                          </Truncate>
                        </td>
                        <td className="num text-right">{money(b.requested_amount)}</td>
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
      {error && <Callout tone="neg" title={error} />}
      <p className="text-sm leading-relaxed text-slate-600">
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
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
      )}
    </Modal>
  )
}
