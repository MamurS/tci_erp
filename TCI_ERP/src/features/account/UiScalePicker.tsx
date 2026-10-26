/** «Размер текста»: the whole interface at 100–200 % (0076). The choice
 * applies at once and is saved for the person, so it follows them to any
 * device. Used on both account pages and in the staff user menu. */

import { useTranslation } from 'react-i18next'

import { UI_SCALES, useUiScaleValue } from '../../lib/uiScale'
import { useSaveUiScale } from './uiScaleApi'

export function UiScalePicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const scale = useUiScaleValue()
  const save = useSaveUiScale()

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && <span className="text-[0.8125rem] text-slate-600">{t('account.uiScale.hint')}</span>}
      <div role="radiogroup" aria-label={t('account.uiScale.title')} className="inline-flex flex-wrap gap-1">
        {UI_SCALES.map((value) => {
          const active = value === scale
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => save.mutate(value)}
              className={`rounded-md border px-2.5 py-1 text-[0.8125rem] tabular-nums transition-colors ${
                active
                  ? 'border-accent-600 bg-accent-600 font-semibold text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value}%
            </button>
          )
        })}
      </div>
      {save.isError && (
        <span className="text-[0.8125rem] text-slate-500" role="status">
          {t('account.uiScale.notSaved')}
        </span>
      )}
    </div>
  )
}
