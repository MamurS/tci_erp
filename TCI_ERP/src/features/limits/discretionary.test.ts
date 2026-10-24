/** Contract test: the DL note follows the declarations' rule (0026) — covered
 * up to the DL with EQUAL included, and a DL of 0 counts as none. */

import { describe, expect, it } from 'vitest'

import M26 from '../../../supabase/migrations/0026_declarations.sql?raw'
import M12 from '../../../supabase/migrations/0012_policyholders_policies.sql?raw'
import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { dlPosition } from './discretionary'

describe('dlPosition mirrors 0026', () => {
  it('equal qualifies, and a missing DL is 0', () => {
    expect(M26).toContain('when p_insurable_turnover <= coalesce(p_discretionary_limit, 0)')
    expect(M12).toContain('and discretionary_limit >= 0')
    expect(dlPosition(500, 500)).toEqual({ kind: 'within', dl: 500 })
    expect(dlPosition(500.01, 500)).toEqual({ kind: 'above', dl: 500, excess: 0.01 })
  })

  it('no DL — null or 0 — says so whatever the amount', () => {
    expect(dlPosition(100, 0)).toEqual({ kind: 'none' })
    expect(dlPosition(null, null)).toEqual({ kind: 'none' })
    expect(dlPosition(100, undefined)).toEqual({ kind: 'none' })
  })

  it('no amount yet names the DL', () => {
    expect(dlPosition(null, 1000)).toEqual({ kind: 'known', dl: 1000 })
    expect(dlPosition(Number.NaN, 1000)).toEqual({ kind: 'known', dl: 1000 })
    expect(dlPosition(0, 1000)).toEqual({ kind: 'known', dl: 1000 })
  })

  it('the excess is cent-exact', () => {
    expect(dlPosition(150_000_000.1, 100_000_000.05)).toEqual({
      kind: 'above',
      dl: 100_000_000.05,
      excess: 50_000_000.05,
    })
  })

  it('every note reads in three languages', () => {
    for (const locale of [en, ru, uz] as Record<string, unknown>[]) {
      const dl = (locale.limits as Record<string, Record<string, Record<string, string>>>).dl
      for (const audience of ['client', 'staff']) {
        for (const kind of ['none', 'known', 'within', 'above']) {
          expect(typeof dl?.[audience]?.[`${kind}Title`]).toBe('string')
          expect(typeof dl?.[audience]?.[`${kind}Body`]).toBe('string')
        }
      }
    }
  })
})
