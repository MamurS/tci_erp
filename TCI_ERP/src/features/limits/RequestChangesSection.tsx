/** «Изменения страхователя» on the limit request page (0075): what the
 * policyholder changed before underwriting took the request, or the change a
 * replacing request carries. Renders nothing when there is none. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Card, SectionTitle } from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { useLimitRequestChanges } from './api'
import type { LimitRequestAmendment } from './types'

export function RequestChangesSection({ requestId }: { requestId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const { data: changes } = useLimitRequestChanges(requestId)
  if (!changes?.length) return null

  const money = (value: number, currency: string) => `${formatAmount(Number(value), locale)} ${currency}`
  const days = (value: number | null) => (value === null ? EM_DASH : t('policies.terms.days', { count: value }))
  const just = (s: string | null) => (s ?? '').trim()

  const lines = (a: LimitRequestAmendment) => [
    ...(Number(a.from_amount) !== Number(a.to_amount)
      ? [t('limits.changes.amount', { from: money(a.from_amount, a.currency_code), to: money(a.to_amount, a.currency_code) })]
      : []),
    ...(a.from_payment_terms_days !== a.to_payment_terms_days
      ? [t('limits.changes.terms', { from: days(a.from_payment_terms_days), to: days(a.to_payment_terms_days) })]
      : []),
    ...(just(a.from_justification) !== just(a.to_justification) ? [t('limits.changes.justification')] : []),
  ]

  return (
    <Card className="p-5" data-testid="request-changes">
      <SectionTitle className="mb-3" hint={t('limits.changes.hint')}>
        {t('limits.changes.title')}
      </SectionTitle>
      <ol className="flex flex-col gap-3">
        {changes.map((a) => (
          <li key={a.id} className="text-body">
            <p className="text-caption text-slate-500">
              {formatMoment(a.amended_at, locale)} · {t(`limits.changes.kinds.${a.kind}`)}
              {a.kind === 'replaced' && a.replaced_request_id && (
                <>
                  {' · '}
                  <Link to={`/limits/${a.replaced_request_id}`} className="text-accent-700 hover:underline">
                    {t('limits.changes.openReplaced')}
                  </Link>
                </>
              )}
            </p>
            <ul className="mt-0.5 text-slate-700">
              {lines(a).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  )
}
