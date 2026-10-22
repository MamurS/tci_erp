/**
 * The country a company name gives away by its legal form: «ТОО …» is
 * Kazakh, «… GmbH» German. Used only to PRE-SELECT the country of a new
 * company in the form — the person still sees it and can change it — so the
 * list is deliberately short and holds only forms that point at one country
 * in this book. Forms shared by several jurisdictions (Ltd, LLC, AG, S.A.,
 * ОАО) are left out: a wrong guess is worse than the default.
 */

/** First word of the name → country. Compared exactly (case and script). */
const PREFIX_FORMS: Record<string, string> = {
  // Kazakhstan
  TOO: 'KZ',
  ТОО: 'KZ',
  ЖШС: 'KZ',
  // Russia
  OOO: 'RU',
  ООО: 'RU',
  AO: 'RU',
  АО: 'RU',
  PAO: 'RU',
  ПАО: 'RU',
  ZAO: 'RU',
  ЗАО: 'RU',
  // Uzbekistan
  MChJ: 'UZ',
  MCHJ: 'UZ',
  МЧЖ: 'UZ',
  AJ: 'UZ',
  АЖ: 'UZ',
  // Ukraine
  TOV: 'UA',
  ТОВ: 'UA',
}

/** Anywhere in the name (usually at the end) → country. */
const SUFFIX_FORMS: [RegExp, string][] = [
  [/(^|\s)GmbH(\s|$|,)/, 'DE'],
  [/(^|\s)A\.Ş\.?(\s|$)/, 'TR'],
  [/(^|\s)Sp\. z o\.o\.?(\s|$)/i, 'PL'],
  [/(^|\s)B\.V\.?(\s|$)/, 'NL'],
]

/** The trailing words too: «Uzbek Textile MChJ», «Samarkand Textile MCHJ». */
const LAST_WORD_FORMS = new Set(['MChJ', 'MCHJ', 'МЧЖ'])

/** ISO country code the legal form in `name` points at, or null. */
export function countryFromLegalForm(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  for (const [pattern, country] of SUFFIX_FORMS) if (pattern.test(trimmed)) return country
  // Quotes around the brand name are common: ООО «Ромашка», TOO "Alma".
  const words = trimmed.split(/[\s«»"“”„']+/).filter(Boolean)
  const first = words[0]
  if (first && words.length > 1 && first in PREFIX_FORMS) return PREFIX_FORMS[first]
  const last = words[words.length - 1]
  if (last && words.length > 1 && LAST_WORD_FORMS.has(last)) return 'UZ'
  return null
}
