/** The person's display settings, choices that apply at once and are
 * saved for them, so they follow them to any device:
 *
 * - «Цветовая тема» (colour theme, 0082): the brand colours;
 * - «Текст на цветных метках» (0089): white or dark text on coloured badges;
 * - «Светлая или тёмная» (0082): light, dark, or as the device;
 * - «Масштаб» (zoom, 0076): the whole interface at 100–200 %;
 * - «Размер текста» (text size, 0081): only the type, 100–150 %; spacing,
 *   boxes and the layout stay as the zoom sets them.
 *
 * Used in the staff user menu (compact) and on both account pages. */

import { useTranslation } from 'react-i18next'

import { UI_SCALES, UI_TEXT_SCALES, useUiScaleValue, useUiTextScaleValue } from '../../lib/uiScale'
import { UI_BADGE_INKS, UI_MODES, UI_THEMES, useUiBadgeInkValue, useUiModeValue, useUiThemeValue } from '../../lib/uiTheme'
import type { UiTheme } from '../../lib/uiTheme'
import { useSaveUiBadgeInk, useSaveUiScale, useSaveUiTextScale, useSaveUiTheme } from './uiScaleApi'

/** Each theme's own colour (tokens.css `--color-swatch-*`), as literal
 * classes so Tailwind emits them. */
const SWATCH: Record<UiTheme, string> = {
  blue: 'bg-swatch-blue',
  salad: 'bg-swatch-salad',
  teal: 'bg-swatch-teal',
  plum: 'bg-swatch-plum',
  graphite: 'bg-swatch-graphite',
}

function ThemeChoice({ label, value, onPick }: { label: string; value: UiTheme; onPick: (value: UiTheme) => void }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1">
      {UI_THEMES.map((theme) => {
        const active = theme === value
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(theme)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1 text-small transition-colors ${
              active
                ? 'border-accent-600 bg-accent-50 font-semibold text-slate-900'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span aria-hidden className={`size-3.5 shrink-0 rounded-full ${SWATCH[theme]}`} />
            {t(`account.uiTheme.names.${theme}`)}
          </button>
        )
      })}
    </div>
  )
}

function ScaleChoice<T extends number | string>({
  label,
  values,
  value,
  onPick,
  format = (v) => `${v}%`,
}: {
  label: string
  values: readonly T[]
  value: T
  onPick: (value: T) => void
  format?: (value: T) => string
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
            {format(v)}
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
  const theme = useUiThemeValue()
  const mode = useUiModeValue()
  const saveTheme = useSaveUiTheme()
  const badgeInk = useUiBadgeInkValue()
  const saveInk = useSaveUiBadgeInk()
  const heading = compact
    ? 'mb-2 text-caption font-medium tracking-wide text-slate-500 uppercase'
    : 'text-body font-medium text-slate-800'

  return (
    <div className={`flex flex-col ${compact ? 'gap-4' : 'gap-5'}`}>
      <div className="flex flex-col gap-2">
        <span className={heading}>{t('account.uiTheme.title')}</span>
        {!compact && <span className="text-small text-slate-600">{t('account.uiTheme.hint')}</span>}
        <ThemeChoice label={t('account.uiTheme.title')} value={theme} onPick={(v) => saveTheme.mutate({ theme: v })} />
      </div>
      <div className="flex flex-col gap-2">
        <span className={heading}>{t('account.uiTheme.mode.title')}</span>
        {!compact && <span className="text-small text-slate-600">{t('account.uiTheme.mode.hint')}</span>}
        <ScaleChoice
          label={t('account.uiTheme.mode.title')}
          values={UI_MODES}
          value={mode}
          onPick={(v) => saveTheme.mutate({ mode: v })}
          format={(v) => t(`account.uiTheme.mode.${v}`)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className={heading}>{t('account.uiBadgeInk.title')}</span>
        {!compact && <span className="text-small text-slate-600">{t('account.uiBadgeInk.hint')}</span>}
        <ScaleChoice
          label={t('account.uiBadgeInk.title')}
          values={UI_BADGE_INKS}
          value={badgeInk}
          onPick={(v) => saveInk.mutate(v)}
          format={(v) => t(`account.uiBadgeInk.${v}`)}
        />
      </div>
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
      {(saveScale.isError || saveText.isError || saveTheme.isError || saveInk.isError) && (
        <span className="text-small text-slate-500" role="status">
          {t('account.uiScale.notSaved')}
        </span>
      )}
    </div>
  )
}
