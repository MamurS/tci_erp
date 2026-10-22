/** The contract status column reserves its widest label in en / ru / uz
 * (columns.ts), with the badge arithmetic of components/ui/columns.ts. */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { CONTRACT_STATUS_CHARS, CONTRACT_STATUS_COL } from './columns'
import { CONTRACT_STATUSES } from './machine'

describe('the contract status column', () => {
  it('is wide enough for the longest status in every language', () => {
    const lengths = [en, ru, uz].flatMap((locale) =>
      CONTRACT_STATUSES.map((s) => [...(locale as { contractDrafts: { statuses: Record<string, string> } }).contractDrafts.statuses[s]!].length),
    )
    expect(Math.max(...lengths)).toBeLessThanOrEqual(CONTRACT_STATUS_CHARS)
    // labelCol(): chars × 0.5rem + 1.125rem badge padding + 2rem cell padding, rounded up to 1/8
    const width = Math.ceil((CONTRACT_STATUS_CHARS * 0.5 + 1.125 + 2) * 8) / 8
    expect(CONTRACT_STATUS_COL).toBe(`${width}rem`)
  })
})
