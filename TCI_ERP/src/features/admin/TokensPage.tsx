/**
 * Admin › «Дизайн-токены» (Prompt 30): every token of the design system on
 * one page — the OKLCH ramps with each step's contrast on white and the
 * pairing rule, the grade scale, the data palettes, the type scale (with
 * Cyrillic and Uzbek Latin samples), spacing, radii, shadows and motion. The
 * values come from src/design/palette.ts, the same source as the CSS, so the
 * page cannot drift from what the screens use.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, PageHeader, SectionTitle } from '../../components/ui'
import { GradeScale } from '../../components/ui/GradeScale'
import { formatRatio } from '../../lib/format'
import { cssOklch, hexToOklch } from '../../design/oklch'
import {
  CANVAS,
  CATEGORICAL,
  contrast,
  GRADE_COLORS,
  GRAPHIC_MIN,
  MOTION,
  RADII,
  RAMP_SPECS,
  RAMPS,
  SEQUENTIAL,
  SHADOWS,
  SPACING_STEPS,
  STEPS,
  TEXT_MIN,
  TYPE_SCALE,
  worstContrastAt,
} from '../../design/palette'
import type { RampName } from '../../design/palette'

/** A sample with Latin, Cyrillic and the Uzbek Latin modifier letters. */
const GLYPHS = 'Aa Ўў Ққ Ғғ Ҳҳ — Oʻzbekiston, gʻalla, Sugʻurta — 0123456789 ₽ $ € 1 234 567,89'

function Swatch({ hex, label }: { hex: string; label: string }) {
  const { i18n } = useTranslation()
  const onWhite = contrast(hex, '#ffffff')
  const ink = contrast(hex, '#ffffff') >= TEXT_MIN ? '#ffffff' : RAMPS.slate[900]
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-slate-200">
      <div className="flex h-14 items-end px-2 pb-1 text-caption font-semibold" style={{ background: hex, color: ink }}>
        {label}
      </div>
      <div className="px-2 py-1 text-caption leading-tight text-slate-600 tabular-nums">
        <div>{hex}</div>
        <div className="truncate" title={cssOklch(hexToOklch(hex))}>
          {cssOklch(hexToOklch(hex))}
        </div>
        <div className={onWhite >= TEXT_MIN ? 'text-success-600' : onWhite >= GRAPHIC_MIN ? 'text-warning-600' : 'text-slate-500'}>
          {formatRatio(onWhite, i18n.language)} : 1
        </div>
      </div>
    </div>
  )
}

export function TokensPage() {
  const { t, i18n } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const five = worstContrastAt(5)
  const four = worstContrastAt(4)

  return (
    <div>
      <PageHeader title={t('tokens.title')} subtitle={t('tokens.subtitle')} />

      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle hint={t('tokens.colour.hint')}>{t('tokens.colour.title')}</SectionTitle>
          <div className="grid gap-3 rounded-md bg-slate-50 p-4 text-small text-slate-700 md:grid-cols-2">
            <p>
              {t('tokens.colour.ruleText', {
                ratio: formatRatio(five.ratio, i18n.language),
                min: formatRatio(TEXT_MIN, i18n.language),
              })}
            </p>
            <p>
              {t('tokens.colour.ruleGraphic', {
                ratio: formatRatio(four.ratio, i18n.language),
                min: formatRatio(GRAPHIC_MIN, i18n.language),
              })}
            </p>
          </div>
          {(Object.keys(RAMPS) as RampName[]).map((name) => (
            <div key={name} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-body font-semibold text-slate-800">{name}</span>
                <span className="text-small text-slate-500">{t(`tokens.ramps.${name}`)}</span>
                <span className="text-caption text-slate-500 tabular-nums">
                  {t('tokens.colour.hue', { hue: RAMP_SPECS[name].hue, chroma: RAMP_SPECS[name].chroma })}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2 lg:grid-cols-10">
                {STEPS.map((step) => (
                  <Swatch key={step} hex={RAMPS[name][step]} label={String(step)} />
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-small text-slate-600">
            <span className="inline-block size-6 rounded border border-slate-200" style={{ background: CANVAS }} />
            {t('tokens.colour.canvas', {
              hex: CANVAS,
              ratio: formatRatio(contrast(RAMPS.slate[500], CANVAS), i18n.language),
            })}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle hint={t('tokens.grades.hint')}>{t('tokens.grades.title')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {Object.entries(GRADE_COLORS).map(([grade, c]) => (
              <div key={grade} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
                <span
                  className="inline-flex w-fit items-center rounded-md px-2 py-0.5 text-small font-semibold"
                  style={{ background: c.tint, color: c.ink }}
                >
                  {grade}
                </span>
                <span className="h-2 rounded-full" style={{ background: c.solid }} />
                <span className="text-caption text-slate-600 tabular-nums">
                  {c.tint} · {c.solid} · {c.ink}
                </span>
                <span className="text-caption text-slate-500 tabular-nums">
                  {t('tokens.grades.pairs', {
                    tint: formatRatio(contrast(c.ink, c.tint), i18n.language),
                    solid: formatRatio(contrast(c.solid, '#ffffff'), i18n.language),
                  })}
                </span>
              </div>
            ))}
          </div>
          <div className="max-w-xl">
            <GradeScale score={47} grade="B2" bands={undefined} />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle hint={t('tokens.data.hint')}>{t('tokens.data.title')}</SectionTitle>
          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-slate-700">{t('tokens.data.categorical')}</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORICAL.map((hex, i) => (
                <span key={hex} className="flex items-center gap-2 text-caption text-slate-600 tabular-nums">
                  <span className="inline-block h-6 w-10 rounded" style={{ background: hex }} />
                  {i + 1}
                </span>
              ))}
            </div>
            <span className="mt-2 text-small font-medium text-slate-700">{t('tokens.data.sequential')}</span>
            <div className="flex">
              {SEQUENTIAL.map((hex) => (
                <span key={hex} className="h-6 flex-1" style={{ background: hex }} />
              ))}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle hint={t('tokens.type.hint')}>{t('tokens.type.title')}</SectionTitle>
          {Object.entries(TYPE_SCALE).map(([name, [size, lineHeight]]) => (
            <div key={name} className="grid gap-x-6 gap-y-1 border-b border-slate-100 pb-3 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)]">
              <span className="text-caption text-slate-500 tabular-nums">
                text-{name} · {size} / {lineHeight}
              </span>
              <span style={{ fontSize: size, lineHeight }} className={name === 'headline' || name === 'display' ? 'font-display font-bold text-accent-700' : 'text-slate-900'}>
                {GLYPHS}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-6 text-body text-slate-800">
            <span className="font-normal">{t('tokens.type.regular')}</span>
            <span className="font-medium">{t('tokens.type.medium')}</span>
            <span className="font-semibold">{t('tokens.type.semibold')}</span>
            <span className="tabular-nums">1 234 567,89 · 98 765,43</span>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle hint={t('tokens.space.hint')}>{t('tokens.space.title')}</SectionTitle>
          <div className="flex flex-col gap-2">
            {SPACING_STEPS.map((step) => (
              <div key={step} className="flex items-center gap-3 text-caption text-slate-600 tabular-nums">
                <span className="w-24">
                  {step} · {step * 4} px
                </span>
                <span className="h-3 rounded-sm bg-sky-300" style={{ width: `${step * 0.25}rem` }} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(RADII).map(([name, value]) => (
              <div key={name} className="flex flex-col items-center gap-1 text-caption text-slate-600">
                <span className="size-14 border border-slate-300 bg-slate-50" style={{ borderRadius: value }} />
                rounded-{name}
              </div>
            ))}
            {Object.entries(SHADOWS).map(([name, value]) => (
              <div key={name} className="flex flex-col items-center gap-1 text-caption text-slate-600">
                <span className="size-14 rounded-lg bg-white" style={{ boxShadow: value }} />
                shadow-{name}
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle
            hint={t('tokens.motion.hint')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => setPlaying((p) => !p)}>
                {t('tokens.motion.play')}
              </Button>
            }
          >
            {t('tokens.motion.title')}
          </SectionTitle>
          <div className="flex flex-col gap-3">
            {Object.entries(MOTION.durations).map(([name, duration]) => (
              <div key={name} className="flex items-center gap-3 text-caption text-slate-600 tabular-nums">
                <span className="w-40">
                  {name} · {duration}
                </span>
                <span className="relative h-3 flex-1 rounded-full bg-slate-100">
                  <span
                    className="absolute top-0 left-0 size-3 rounded-full bg-accent-600"
                    style={{
                      transform: playing ? 'translateX(min(30rem, 60vw))' : 'none',
                      transition: `transform ${duration} ${
                        name.startsWith('fast') || name === 'moderate-01'
                          ? MOTION.easings['productive-standard']
                          : MOTION.easings['expressive-standard']
                      }`,
                    }}
                  />
                </span>
                <Badge tone={name.startsWith('fast') || name === 'moderate-01' ? 'neutral' : 'accent'}>
                  {name.startsWith('fast') || name === 'moderate-01' ? t('tokens.motion.productive') : t('tokens.motion.expressive')}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-small text-slate-500">{t('tokens.motion.reduced')}</p>
        </Card>
      </div>
    </div>
  )
}
