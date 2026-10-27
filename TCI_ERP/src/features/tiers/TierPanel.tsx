/**
 * «Уровень страхователя» on the company card (migration 0094): the tier in
 * force, how it was reached — the insured turnover and the premium, each with
 * the tier it reaches and what the next one needs — or who set it by hand,
 * why and until when; commercial underwriting sets or ends a manual tier
 * here; the history of manual tiers below. Nothing here decides anything:
 * a tier is a service class.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Button, Callout, Card, Field, HumanAmount, Modal, SectionTitle, Select, Textarea } from '../../components/ui'
import { DateInput } from '../../components/ui/DateInput'
import { todayIso } from '../../components/ui/dateEntry'
import { formatAmount, formatDate, formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useStaffDirectory } from '../data/api'
import { useEndTierOverride, usePolicyholderTier, useSetTier, useTierHistory, useTierThresholds } from './api'
import type { PolicyholderTier } from './api'
import { maySetTier, nextStep, TIER_REASON_MAX, TIER_REASON_MIN, TIERS } from './model'
import type { Tier, TierMeasure, TierThresholds } from './model'
import { TierBadge } from './TierBadge'
import { TIER_SOLID } from './tierTone'

export function TierPanel({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole } = useAuth()
  const row = usePolicyholderTier(entityId)
  const thresholds = useTierThresholds()
  const people = useStaffDirectory()
  const [setting, setSetting] = useState(false)
  const [ending, setEnding] = useState(false)
  const writer = maySetTier(actingRole)

  if (!row) return null
  const who = (id: string | null) => (id ? (people.data?.get(id)?.full_name ?? people.data?.get(id)?.email ?? '—') : '—')

  return (
    <Card className="flex flex-col gap-5 p-5" data-tier-panel>
      <SectionTitle
        hint={t('tiers.panel.hint')}
        actions={
          writer ? (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSetting(true)}>
                {t('tiers.panel.setByHand')}
              </Button>
              {row.is_manual && (
                <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>
                  {t('tiers.panel.backToAutomatic')}
                </Button>
              )}
            </span>
          ) : undefined
        }
      >
        {t('tiers.panel.title')}
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-3">
        <TierBadge tier={row.tier} manual={row.is_manual} size="md" />
        <span className="text-body text-slate-700">
          {row.is_manual
            ? t('tiers.panel.manualLine', {
                who: who(row.override_set_by),
                when: row.override_set_at ? formatDate(row.override_set_at, locale) : '—',
              })
            : t('tiers.panel.automaticLine')}
        </span>
      </div>

      {row.is_manual && (
        <Callout tone="info" title={t('tiers.panel.manualReason', { reason: row.override_reason ?? '' })}>
          {row.override_until
            ? t('tiers.panel.manualUntil', { date: formatDate(row.override_until, locale) })
            : t('tiers.panel.manualOpen')}{' '}
          {t('tiers.panel.automaticWouldBe', { tier: t(`tiers.name.${row.automatic_tier}`) })}
        </Callout>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <MeasureBlock row={row} measure="turnover_uzs" thresholds={thresholds.data} />
        <MeasureBlock row={row} measure="premium_uzs" thresholds={thresholds.data} />
      </div>

      {row.missing_rates > 0 && (
        <Callout tone="warn" title={t('tiers.panel.missingRates', { count: row.missing_rates })} />
      )}

      <History entityId={entityId} who={who} />

      {setting && <SetTierModal row={row} onClose={() => setSetting(false)} />}
      {ending && <EndOverrideModal entityId={entityId} onClose={() => setEnding(false)} />}
    </Card>
  )
}

function MeasureBlock({
  row,
  measure,
  thresholds,
}: {
  row: PolicyholderTier
  measure: TierMeasure
  thresholds: TierThresholds | undefined
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const amount = measure === 'turnover_uzs' ? row.turnover_uzs : row.premium_uzs
  const reached: Tier = measure === 'turnover_uzs' ? row.turnover_tier : row.premium_tier
  const step = thresholds ? nextStep(amount, measure, thresholds) : null
  const basis =
    measure === 'turnover_uzs'
      ? t(`tiers.basis.${row.turnover_basis}`, { count: row.declarations_counted })
      : t('tiers.basis.premium', { count: row.current_policies })

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4" data-tier-measure={measure}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-small font-medium text-slate-600">{t(`tiers.measure.${measure}`)}</span>
        <TierBadge tier={reached} size="sm" />
      </div>
      <span className="text-title font-semibold text-slate-900 tabular-nums">
        {amount === null ? '—' : <HumanAmount value={amount} currency="UZS" />}
      </span>
      <span className="text-small text-slate-500">{basis}</span>
      {thresholds &&
        (step ? (
          <div className="flex flex-col gap-1">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-slate-100"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(step.share * 100)}
              aria-label={t('tiers.panel.toNext', { tier: t(`tiers.name.${step.tier}`) })}
            >
              <div className={`h-full rounded-full ${TIER_SOLID[step.tier]}`} style={{ width: `${step.share * 100}%` }} />
            </div>
            <span className="text-small text-slate-600">
              {t('tiers.panel.nextNeeds', {
                tier: t(`tiers.name.${step.tier}`),
                missing: formatAmount(step.missing, locale, 0),
                threshold: formatAmount(step.threshold, locale, 0),
              })}
            </span>
          </div>
        ) : (
          <span className="text-small text-slate-600">{t('tiers.panel.top')}</span>
        ))}
    </div>
  )
}

function History({ entityId, who }: { entityId: string; who: (id: string | null) => string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const history = useTierHistory(entityId)
  const rows = history.data ?? []
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-small font-semibold tracking-wide text-slate-600 uppercase">{t('tiers.history.title')}</h4>
      <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-col gap-1 px-4 py-3 text-body">
            <span className="flex flex-wrap items-center gap-2">
              <TierBadge tier={o.tier} size="sm" />
              <span className="text-slate-700">
                {t('tiers.history.setBy', { who: who(o.set_by), when: formatMoment(o.set_at, locale) })}
              </span>
              {o.valid_until && (
                <span className="text-small text-slate-500">{t('tiers.history.until', { date: formatDate(o.valid_until, locale) })}</span>
              )}
            </span>
            <span className="text-slate-800">«{o.reason}»</span>
            {o.ended_at && (
              <span className="text-small text-slate-500">
                {t('tiers.history.ended', { who: who(o.ended_by), when: formatMoment(o.ended_at, locale) })}
                {o.end_reason ? ` — «${o.end_reason}»` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SetTierModal({ row, onClose }: { row: PolicyholderTier; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useSetTier()
  const [tier, setTier] = useState<Tier>(row.tier)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= TIER_REASON_MIN

  const submit = () => {
    setError(null)
    save
      .mutateAsync({ entityId: row.entity_id, tier, reason: reason.trim(), until: until || null })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('tiers.set.title', { name: row.entity_name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!reasonOk} onClick={submit}>
            {t('tiers.set.submit', { tier: t(`tiers.name.${tier}`) })}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">
        {t('tiers.set.intro', { tier: t(`tiers.name.${row.automatic_tier}`) })}
      </p>
      <Field label={t('tiers.set.tier')}>
        <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIERS.map((x) => (
            <option key={x} value={x}>
              {t(`tiers.name.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('tiers.set.reason')} hint={t('tiers.set.reasonHint')}>
        <Textarea rows={3} maxLength={TIER_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t('tiers.set.until')} hint={t('tiers.set.untilHint')}>
        <DateInput value={until} onChange={setUntil} min={todayIso()} />
      </Field>
    </Modal>
  )
}

function EndOverrideModal({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const end = useEndTierOverride()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setError(null)
    end
      .mutateAsync({ entityId, reason: reason.trim() })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }
  return (
    <Modal
      open
      title={t('tiers.end.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={end.isPending} disabled={reason.trim().length < TIER_REASON_MIN} onClick={submit}>
            {t('tiers.end.submit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('tiers.end.intro')}</p>
      <Field label={t('tiers.end.reason')}>
        <Textarea rows={3} maxLength={TIER_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}
