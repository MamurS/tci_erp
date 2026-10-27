/**
 * Admin › Риски › «Санкционный скрининг» (migration 0091,
 * tci.set_sanctions_settings): how close a name on a list must be to count
 * as a possible match, how old a list may get before credit analysts are
 * reminded, and which official lists are expected. A technical setting —
 * the matches themselves are the credit analysts' to confirm or clear.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Card, Field, SectionTitle, Skeleton, useFlash } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { refusalOr } from '../../lib/optimistic'
import { useSaveSanctionsSettings, useSanctionsSettings } from './api'
import { REQUIRED_LISTS } from './lists/parse'
import { STALE_DAYS_BOUNDS, THRESHOLD_BOUNDS } from './model'

interface Draft {
  percent: string
  days: string
  lists: string[]
}

export function SanctionsSettingsCard() {
  const { t } = useTranslation()
  const settings = useSanctionsSettings()
  const save = useSaveSanctionsSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, flashSaved] = useFlash()

  const stored: Draft | null = settings.data
    ? {
        percent: String(Math.round(Number(settings.data.sanctions_match_threshold) * 100)),
        days: String(settings.data.sanctions_list_stale_days),
        lists: [...settings.data.sanctions_required_lists],
      }
    : null
  const d = draft ?? stored
  const percent = d ? parseAmount(d.percent) : null
  const days = d ? parseAmount(d.days) : null
  const percentBad =
    percent === null || percent < THRESHOLD_BOUNDS.min * 100 || percent > THRESHOLD_BOUNDS.max * 100 || !Number.isInteger(percent)
  const daysBad = days === null || days < STALE_DAYS_BOUNDS.min || days > STALE_DAYS_BOUNDS.max || !Number.isInteger(days)
  const changed =
    d !== null &&
    stored !== null &&
    (d.percent !== stored.percent || d.days !== stored.days || [...d.lists].sort().join() !== [...stored.lists].sort().join())

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('sanctions.settings.hint')}>{t('sanctions.settings.title')}</SectionTitle>
      {settings.isLoading || (!d && !settings.isError) ? (
        <Skeleton className="h-32 w-full" />
      ) : settings.isError || !d ? (
        <Callout tone="neg" title={t('sanctions.settings.loadFailed')} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('sanctions.settings.threshold')}
              hint={t('sanctions.settings.thresholdHint', { min: THRESHOLD_BOUNDS.min * 100, max: THRESHOLD_BOUNDS.max * 100 })}
              error={draft && percentBad ? t('admin.risk.settings.outOfRange', { min: 30, max: 100 }) : null}
            >
              <AmountInput decimals={0} value={d.percent} onChange={(v) => setDraft({ ...d, percent: v })} suffix="%" />
            </Field>
            <Field
              label={t('sanctions.settings.staleDays')}
              hint={t('sanctions.settings.staleDaysHint')}
              error={draft && daysBad ? t('admin.risk.settings.outOfRange', STALE_DAYS_BOUNDS) : null}
            >
              <AmountInput decimals={0} value={d.days} onChange={(v) => setDraft({ ...d, days: v })} suffix={t('admin.risk.settings.days')} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-small font-medium text-slate-700">{t('sanctions.settings.required')}</legend>
            {REQUIRED_LISTS.map((l) => (
              <label key={l} className="flex items-center gap-2 text-body text-slate-800">
                <input
                  type="checkbox"
                  checked={d.lists.includes(l)}
                  onChange={(e) =>
                    setDraft({ ...d, lists: e.target.checked ? [...d.lists, l] : d.lists.filter((x) => x !== l) })
                  }
                />
                {t(`sanctions.lists.name.${l}`)}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!changed || percentBad || daysBad}
              loading={save.isPending}
              done={saved}
              onClick={() => {
                if (percent === null || days === null) return
                setError(null)
                save.mutate(
                  {
                    sanctions_match_threshold: percent / 100,
                    sanctions_list_stale_days: days,
                    sanctions_required_lists: d.lists,
                  },
                  {
                    onSuccess: () => {
                      setDraft(null)
                      flashSaved()
                    },
                    onError: (failure) => setError(t(refusalOr(failure, 'sanctions.settings.saveFailed'))),
                  },
                )
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
