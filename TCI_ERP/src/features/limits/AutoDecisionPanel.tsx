/**
 * What the auto-decision rule said about this limit request (migration 0061),
 * for the credit desk only: decided automatically within the buyer's ADT —
 * with what the rule saw (the rating, the recommended limit, the ADT before
 * and after) — or handed to an underwriter, with every reason, translated.
 * The latest evaluation wins; nothing renders when there was none (the
 * switch was off, or the request was never submitted while it was on).
 */

import { useTranslation } from 'react-i18next'

import { Callout, DescriptionList } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { adtNumber, canSeeAdt, isKnownReason, latestAttempt } from './adt'
import type { AttemptSnapshot } from './adt'
import { useAutoDecisionAttempts } from './adtApi'

export function AutoDecisionPanel({ requestId }: { requestId: string }) {
  const { roles } = useAuth()
  const desk = canSeeAdt(roles)
  const { data } = useAutoDecisionAttempts(requestId, desk)
  if (!desk) return null
  const attempt = latestAttempt(data ?? [])
  if (!attempt) return null
  return attempt.decided ? (
    <Decided snapshot={attempt.snapshot} at={attempt.attempted_at} />
  ) : (
    <HandedOver reasons={attempt.reasons} at={attempt.attempted_at} />
  )
}

function money(amount: unknown, currency: unknown, locale: string): string {
  const n = adtNumber(amount)
  return n === null || typeof currency !== 'string' ? EM_DASH : `${formatAmount(n, locale)} ${currency}`
}

function Decided({ snapshot: s, at }: { snapshot: AttemptSnapshot; at: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const total = adtNumber(s.adt_total)
  const left = (n: unknown) =>
    adtNumber(n) === null || total === null ? EM_DASH : t('limits.auto.attempt.leftOf', { left: adtNumber(n), total })
  return (
    <Callout tone="pos" title={t('limits.auto.attempt.decided')}>
      <p className="mb-2">{t('limits.auto.attempt.decidedHint', { date: formatMoment(at, locale) })}</p>
      <DescriptionList
        columns={2}
        items={[
          {
            label: t('limits.auto.attempt.rating'),
            value: s.rating_grade
              ? `${s.rating_grade}${adtNumber(s.rating_score) === null ? '' : ` · ${formatAmount(adtNumber(s.rating_score), locale, 0)}`}`
              : EM_DASH,
          },
          { label: t('limits.auto.attempt.recommended'), value: money(s.recommended_limit, s.recommended_currency, locale) },
          { label: t('limits.auto.attempt.requested'), value: money(s.requested_amount, s.requested_currency, locale) },
          { label: t('limits.auto.attempt.adtAmount'), value: money(s.adt_max_amount, s.adt_currency, locale) },
          { label: t('limits.auto.attempt.adtBefore'), value: left(s.adt_remaining_before) },
          { label: t('limits.auto.attempt.adtAfter'), value: left(s.adt_remaining_after) },
        ]}
      />
    </Callout>
  )
}

function HandedOver({ reasons, at }: { reasons: readonly string[]; at: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  return (
    <Callout tone="info" title={t('limits.auto.attempt.toUnderwriter')}>
      <p>{t('limits.auto.attempt.toUnderwriterHint', { date: formatMoment(at, locale) })}</p>
      <ul className="mt-2 list-disc pl-5">
        {reasons.map((r) => (
          <li key={r}>{isKnownReason(r) ? t(`limits.auto.reasons.${r}`) : t('limits.auto.attempt.otherReason')}</li>
        ))}
      </ul>
    </Callout>
  )
}
