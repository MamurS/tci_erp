/** The person's display settings, two choices that apply at once and are
 * saved for them, so they follow them to any device:
 *
 * - «Масштаб» (zoom, 0076): the whole interface at 100–200 %;
 * - «Размер текста» (text size, 0081): only the type, 100–150 %; spacing,
 *   boxes and the layout stay as the zoom sets them.
 *
 * Used in the staff user menu (compact) and on both account pages. */

import { useTranslation } from 'react-i18next'

import { UI_SCALES, UI_TEXT_SCALES, useUiScaleValue, useUiTextScaleValue } from '../../lib/uiScale'
import { useSaveUiScale, useSaveUiTextScale } from './uiScaleApi'

function ScaleChoice<T extends number>({
  label,
  values,
  value,
  onPick,
}: {
  label: string
  values: readonly T[]
  value: T
  onPick: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1">
      {values.map((v) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(v)}
            className={`rounded-md border px-3 py-1 text-small tabular-nums transition-colors ${
              active
                ? 'border-accent-600 bg-accent-600 font-semibold text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {v}%
          </button>
        )
      })}
    </div>
  )
}

export function DisplaySettings({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const scale = useUiScaleValue()
  const text = useUiTextScaleValue()
  const saveScale = useSaveUiScale()
  const saveText = useSaveUiTextScale()
  const heading = compact
    ? 'mb-2 text-caption font-medium tracking-wide text-slate-500 uppercase'
    : 'text-body font-medium text-slate-800'

  return (
    <div className={`flex flex-col ${compact ? 'gap-4' : 'gap-5'}`}>
      <div className="flex flex-col gap-2">
        <span className={heading}>{t('account.uiText.title')}</span>
        {!compact && <span className="text-small text-slate-600">{t('account.uiText.hint')}</span>}
        <ScaleChoice
          label={t('account.uiText.title')}
          values={UI_TEXT_SCALES}
          value={text}
          onPick={(v) => saveText.mutate(v)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className={heading}>{t('account.uiScale.title')}</span>
        {!compact && <span className="text-small text-slate-600">{t('account.uiScale.hint')}</span>}
        <ScaleChoice
          label={t('account.uiScale.title')}
          values={UI_SCALES}
          value={scale}
          onPick={(v) => saveScale.mutate(v)}
        />
      </div>
      {(saveScale.isError || saveText.isError) && (
        <span className="text-small text-slate-500" role="status">
          {t('account.uiScale.notSaved')}
        </span>
      )}
    </div>
  )
}
