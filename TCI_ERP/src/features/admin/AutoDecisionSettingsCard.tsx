/**
 * Admin › «Авторешения (ADT)» (migration 0061): the global switch for auto
 * decisions on credit limits, how long an auto-decided limit is valid, and
 * how old a buyer's financials may be before its ADT is suspended. OFF by
 * default; switching it ON asks first, because it should happen only once
 * the rating engine is calibrated and the analytics service is hosted.
 *
 * tci.set_auto_decision_settings reads a missing switch as OFF, so every
 * save sends the switch as it stands.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Badge, Button, Callout, Card, ConfirmDialog, Field, SectionTitle, Skeleton } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { refusalOr } from '../../lib/optimistic'
import { ADT_SETTINGS_BOUNDS, settingsValid } from '../limits/adt'
import { useAutoDecisionSettings, useSetAutoDecisionSettings } from '../limits/adtApi'

export function AutoDecisionSettingsCard() {
  const { t } = useTranslation()
  const { data: settings, isLoading, isError } = useAutoDecisionSettings()
  const save = useSetAutoDecisionSettings()
  const [validity, setValidity] = useState('')
  const [age, setAge] = useState('')
  const [confirmOn, setConfirmOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // The fields start from what is stored, once it arrives.
  useEffect(() => {
    if (!settings) return
    setValidity((v) => v || String(settings.validity_months))
    setAge((a) => a || String(settings.financials_max_age_months))
  }, [settings])

  const validityMonths = parseAmount(validity)
  const financialsMaxAgeMonths = parseAmount(age)
  const valid = settingsValid({ validityMonths, financialsMaxAgeMonths })
  const changed =
    settings !== null &&
    settings !== undefined &&
    (validityMonths !== settings.validity_months || financialsMaxAgeMonths !== settings.financials_max_age_months)

  const write = (enabled: boolean) => {
    if (!settings) return
    setError(null)
    setSaved(false)
    save.mutate(
      {
        enabled,
        validityMonths: valid && validityMonths !== null ? validityMonths : settings.validity_months,
        financialsMaxAgeMonths:
          valid && financialsMaxAgeMonths !== null ? financialsMaxAgeMonths : settings.financials_max_age_months,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (failure) => setError(t(refusalOr(failure, 'admin.autoDecisions.saveFailed'))),
      },
    )
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.autoDecisions.hint')}>{t('admin.autoDecisions.title')}</SectionTitle>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : isError || !settings ? (
        <Callout tone="neg" title={t('admin.autoDecisions.loadFailed')} />
      ) : (
        <>
          <div
            className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-[13px] text-slate-700 ${
              settings.enabled ? 'border-pos-500/30 bg-pos-50' : 'border-warn-500/30 bg-warn-50'
            }`}
          >
            <Badge tone={settings.enabled ? 'pos' : 'warn'}>
              {t(settings.enabled ? 'admin.autoDecisions.on' : 'admin.autoDecisions.off')}
            </Badge>
            <span className="min-w-0 flex-1">
              {t(settings.enabled ? 'admin.autoDecisions.onBody' : 'admin.autoDecisions.offBody')}
            </span>
            <Button
              size="sm"
              variant={settings.enabled ? 'secondary' : 'primary'}
              onClick={() => (settings.enabled ? write(false) : setConfirmOn(true))}
            >
              {t(settings.enabled ? 'admin.autoDecisions.disable' : 'admin.autoDecisions.enable')}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('admin.autoDecisions.validity')}
              hint={t('admin.autoDecisions.validityHint', ADT_SETTINGS_BOUNDS.validityMonths)}
            >
              <AmountInput decimals={0} value={validity} onChange={setValidity} suffix={t('admin.autoDecisions.months')} />
            </Field>
            <Field
              label={t('admin.autoDecisions.financialsAge')}
              hint={t('admin.autoDecisions.financialsAgeHint', ADT_SETTINGS_BOUNDS.financialsMaxAgeMonths)}
            >
              <AmountInput decimals={0} value={age} onChange={setAge} suffix={t('admin.autoDecisions.months')} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => write(settings.enabled)} disabled={!valid || !changed} loading={save.isPending}>
              {t('common.save')}
            </Button>
            {!valid && <span className="text-[13px] text-warn-500">{t('admin.autoDecisions.invalid')}</span>}
            {saved && !save.isPending && valid && !changed && (
              <span className="text-[13px] text-slate-500" role="status">
                {t('admin.autoDecisions.saved')}
              </span>
            )}
          </div>
          {error && <Callout tone="neg" title={error} />}
        </>
      )}

      <ConfirmDialog
        open={confirmOn}
        title={t('admin.autoDecisions.confirmTitle')}
        message={t('admin.autoDecisions.confirmBody')}
        confirmLabel={t('admin.autoDecisions.enable')}
        tone="primary"
        onCancel={() => setConfirmOn(false)}
        onConfirm={() => {
          setConfirmOn(false)
          write(true)
        }}
      />
    </Card>
  )
}
