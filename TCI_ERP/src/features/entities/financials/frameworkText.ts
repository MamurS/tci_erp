/** Localised text for frameworks, templates and template lines: the
 *  database carries en / ru / uz columns plus the caption as printed on the
 *  official form (`name_local`). */

import type { ReportingFramework, StatementTemplate, TemplateLine } from './localApi'

type Localised = { name_en: string; name_ru: string; name_uz: string }

export function localName(row: Localised, locale: string): string {
  if (locale === 'ru') return row.name_ru
  if (locale === 'uz') return row.name_uz
  return row.name_en
}

export function frameworkShort(framework: ReportingFramework, locale: string): string {
  if (locale === 'ru') return framework.short_ru
  if (locale === 'uz') return framework.short_uz
  return framework.short_en
}

export function templateName(template: StatementTemplate, locale: string): string {
  return localName(template, locale)
}

/** The official caption, when it adds something to the UI-language name:
 *  a German or Chinese form is typed from the German or Chinese caption. */
export function originalCaption(line: TemplateLine, locale: string): string | null {
  const shown = localName(line, locale)
  if (!line.name_local || line.name_local === shown) return null
  return line.name_local
}
