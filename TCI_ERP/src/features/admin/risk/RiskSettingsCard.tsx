/**
 * Admin › Риски › «Настройки рисков» (migration 0085, tci.set_risk_settings):
 * the day a quarterly sector review is due, whether a sector review needs a
 * second analyst, how old the OECD list may get, the concentration warning
 * threshold, and whether a client may ever see a country's OECD category.
 * Every save sends every value as it stands — the function reads a missing
 * switch as off.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Card, Field, SectionTitle, Skeleton, useFlash } from '../../../components/ui'
import { parseAmount } from '../../../components/ui/amount'
import { refusalOr } from '../../../lib/optimistic'
import { useRiskSettings, useSetRiskSettings } from '../../risk/api'
import { RISK_BOUNDS, sameSettings, settingsProblems } from './riskSettingsForm'
import type { GeneralSettings, SettingsField } from './riskSettingsForm'

interface Draft {
  sector_review_due_day: string
  sector_review_four_eyes: boolean
  oecd_stale_months: string
  concentration_warn_pct: string
  client_show_oecd: boolean
}

function toDraft(s: GeneralSettings): Draft {
  return {
    sector_review_due_day: String(s.sector_review_due_day),
    sector_review_four_eyes: s.sector_review_four_eyes,
    oecd_stale_months: String(s.oecd_stale_months),
    concentration_warn_pct: String(s.concentration_warn_pct),
    client_show_oecd: s.client_show_oecd,
  }
}

export function RiskSettingsCard() {
  const { t } = useTranslation()
  const settings = useRiskSettings()
  const save = useSetRiskSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, flashSaved] = useFlash()

  const stored: GeneralSettings | null = settings.data
    ? {
        sector_review_due_day: settings.data.sector_review_due_day,
        sector_review_four_eyes: settings.data.sector_review_four_eyes,
        oecd_stale_months: settings.data.oecd_stale_months,
        concentration_warn_pct: settings.data.concentration_warn_pct,
        client_show_oecd: settings.data.client_show_oecd,
      }
    : null
  const d = draft ?? (stored ? toDraft(stored) : null)

  const numbers = d
    ? {
        sector_review_due_day: parseAmount(d.sector_review_due_day),
        oecd_stale_months: parseAmount(d.oecd_stale_months),
        concentration_warn_pct: parseAmount(d.concentration_warn_pct),
      }
    : null
  const problems = numbers ? settingsProblems(numbers) : []
  const next: GeneralSettings | null =
    d && numbers && problems.length === 0
      ? {
          sector_review_due_day: numbers.sector_review_due_day!,
          sector_review_four_eyes: d.sector_review_four_eyes,
          oecd_stale_months: numbers.oecd_stale_months!,
          concentration_warn_pct: numbers.concentration_warn_pct!,
          client_show_oecd: d.client_show_oecd,
        }
      : null
  const changed = next !== null && stored !== null && !sameSettings(stored, next)

  const edit = (patch: Partial<Draft>) => {
    if (!d) return
    setError(null)
    setDraft({ ...d, ...patch })
  }

  const fieldError = (f: SettingsField, b: { min: number; max: number }) =>
    draft !== null && problems.includes(f) ? t('admin.risk.settings.outOfRange', b) : null

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.risk.settings.hint')}>{t('admin.risk.settings.title')}</SectionTitle>

      {settings.isLoading || (!d && !settings.isError) ? (
        <Skeleton className="h-40 w-full" />
      ) : settings.isError || !d ? (
        <Callout tone="neg" title={t('admin.risk.settings.loadFailed')} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t('admin.risk.settings.dueDay')}
              hint={t('admin.risk.settings.dueDayHint', RISK_BOUNDS.sectorReviewDueDay)}
              error={fieldError('sector_review_due_day', RISK_BOUNDS.sectorReviewDueDay)}
            >
              <AmountInput
                decimals={0}
                value={d.sector_review_due_day}
                onChange={(v) => edit({ sector_review_due_day: v })}
                suffix={t('admin.risk.settings.days')}
              />
            </Field>
            <Field
              label={t('admin.risk.settings.staleMonths')}
              hint={t('admin.risk.settings.staleMonthsHint', RISK_BOUNDS.oecdStaleMonths)}
              error={fieldError('oecd_stale_months', RISK_BOUNDS.oecdStaleMonths)}
            >
              <AmountInput
                decimals={0}
                value={d.oecd_stale_months}
                onChange={(v) => edit({ oecd_stale_months: v })}
                suffix={t('admin.autoDecisions.months')}
              />
            </Field>
            <Field
              label={t('admin.risk.settings.warnPct')}
              hint={t('admin.risk.settings.warnPctHint', RISK_BOUNDS.concentrationWarnPct)}
              error={fieldError('concentration_warn_pct', RISK_BOUNDS.concentrationWarnPct)}
            >
              <AmountInput
                decimals={2}
                value={d.concentration_warn_pct}
                onChange={(v) => edit({ concentration_warn_pct: v })}
                suffix="%"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={d.sector_review_four_eyes}
                onChange={(e) => edit({ sector_review_four_eyes: e.target.checked })}
              />
              <span>
                <span className="block text-body font-medium text-slate-800">{t('admin.risk.settings.fourEyes')}</span>
                <span className="block text-caption text-slate-500">{t('admin.risk.settings.fourEyesHint')}</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={d.client_show_oecd}
                onChange={(e) => edit({ client_show_oecd: e.target.checked })}
              />
              <span>
                <span className="block text-body font-medium text-slate-800">{t('admin.risk.settings.clientShowOecd')}</span>
                <span className="block text-caption text-slate-500">{t('admin.risk.settings.clientShowOecdHint')}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!changed}
              loading={save.isPending}
              done={saved}
              onClick={() => {
                if (!next) return
                setError(null)
                save.mutate(next, {
                  onSuccess: () => {
                    setDraft(null)
                    flashSaved()
                  },
                  onError: (failure) => setError(t(refusalOr(failure, 'admin.risk.settings.saveFailed'))),
                })
              }}
            >
              {t('common.save')}
            </Button>
            {draft !== null && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('admin.risk.adjustments.undo')}
              </Button>
            )}
          </div>
          {error && <Callout tone="neg" title={error} />}
        </>
      )}
    </Card>
  )
}
