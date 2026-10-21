/**
 * What the company picker searches for when a submission buyer, entered as a
 * bare name, is to be linked to the registry. The picker matches its query as
 * one piece of text, so the name exactly as typed — «TOO Almaty Stroy Invest»
 * — finds nothing when the registry says «Almaty Stroy Invest LLP». The legal
 * form is dropped first, then words from the end, and the longest query that
 * still finds a company wins; with no match at all, the name without its
 * legal form is offered, ready to be edited.
 */

import { normalize } from '../../components/ui/combobox'

/** Legal forms as they are written in the registries we see (compared without
 * dots, case or diacritics: «S.r.l.» → «srl», «A.Ş.» → «as»). */
const LEGAL_FORMS = new Set([
  // Uzbekistan, Kazakhstan, Russia and neighbours
  'too', 'тоо', 'ooo', 'ооо', 'mchj', 'мчж', 'xk', 'хк', 'aj', 'аж', 'qk', 'ao', 'ао', 'zao', 'зао',
  'oao', 'оао', 'pao', 'пао', 'ip', 'ип', 'chp', 'чп', 'yatt', 'oaj',
  // English-speaking and international
  'llc', 'llp', 'ltd', 'limited', 'inc', 'corp', 'co', 'plc', 'jsc', 'ojsc', 'pjsc', 'cjsc', 'fze', 'fzco', 'fzllc',
  // Continental Europe and Turkey
  'gmbh', 'ag', 'kg', 'sa', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv', 'as', 'ab', 'oy', 'kft', 'sro', 'spzoo', 'zoo',
])

function bare(word: string): string {
  return normalize(word).replace(/[^\p{L}\p{N}]/gu, '')
}

/** The proposed name without legal forms and quotes, as words. */
export function nameCore(name: string): string[] {
  return name
    .replace(/[«»"“”„]/g, ' ')
    .split(/[\s,]+/)
    .filter((word) => word && bare(word) !== '' && !LEGAL_FORMS.has(bare(word)))
}

export function resolutionSeed(name: string | null | undefined, registryNames: readonly string[]): string | undefined {
  const raw = (name ?? '').trim()
  if (!raw) return undefined
  const core = nameCore(raw)
  if (!core.length) return raw
  const names = registryNames.map(normalize)
  const finds = (query: string) => {
    const q = normalize(query)
    return q.length >= 3 && names.some((n) => n.includes(q))
  }
  if (finds(raw)) return raw
  for (let n = core.length; n >= 1; n--) {
    const query = core.slice(0, n).join(' ')
    if (finds(query)) return query
  }
  return core.join(' ')
}
