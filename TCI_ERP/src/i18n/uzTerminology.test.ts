/** Owner-dictated Uzbek insurance terminology (CLAUDE.md glossary).
 * These strings are contractual: they were dictated by the owner and must
 * not drift. The cancel/revoke homonymy is INTENTIONAL — the short status
 * label is shared, but every button and confirmation names its object.
 * «Bekor qilish» is RESERVED for domain actions: the generic modal dismiss
 * is «Yopish», so the phrase never appears without an object. */

import { describe, expect, it } from 'vitest'

import uz from './locales/uz.json'

describe('uz: cancel / annul / revoke / withdraw families', () => {
  it('policy cancellation uses the bekor qilish family, naming the object', () => {
    expect(uz.policies.statuses.cancelled).toBe('Bekor qilingan')
    expect(uz.policies.transitions.cancelled).toBe('Shartnomani bekor qilish')
  })

  it('policy annulment uses the annulyatsiya family', () => {
    expect(uz.policies.statuses.annulled).toBe('Annulyatsiya qilingan')
    expect(uz.policies.transitions.annulled).toBe('Annulyatsiya qilish')
    // the confirmation points at the cancel button by its full label
    expect(uz.policies.transitionConfirm.annulled).toContain('Shartnomani bekor qilish')
  })

  it('limit revocation shares the status label but names the object in the action', () => {
    expect(uz.limits.outcomes.revoked).toBe('Bekor qilingan')
    expect(uz.limits.lifecycles.revoked_lc).toBe('Bekor qilingan')
    expect(uz.limits.actions.revoke).toBe('Limitni bekor qilish')
  })

  it('request withdrawal is a DIFFERENT family from revocation', () => {
    expect(uz.limits.statuses.withdrawn).toBe('Qaytarib olingan')
    expect(uz.limits.timeline.withdrawn).toBe('Qaytarib olingan')
    expect(uz.limits.actions.withdraw).toBe('Qaytarib olish')
    expect(uz.limits.fields.withdrawComment).toBe('Qaytarib olish izohi')
    expect(uz.limits.withdrawConfirm).toContain('qaytarib olinsinmi')
    // withdrawal must never be phrased as a revocation
    expect(uz.limits.statuses.withdrawn).not.toBe(uz.limits.outcomes.revoked)
  })

  it('no string still uses the retired «chaqirib olish» family', () => {
    const flat = JSON.stringify(uz)
    expect(flat.toLowerCase()).not.toContain('chaqirib')
  })

  it('every domain action that says "bekor qilish" names its object', () => {
    const domainActions = [uz.policies.transitions.cancelled, uz.limits.actions.revoke]
    for (const label of domainActions) {
      expect(label.toLowerCase()).toContain('bekor qilish')
      // an object precedes the verb (Shartnomani…, Limitni…)
      expect(label.toLowerCase()).not.toBe('bekor qilish')
      expect(label).toMatch(/^\S+ni\s/)
    }
  })

  it('annulment keeps its object-less action label as shipped', () => {
    // Deliberate: «Annulyatsiya qilish» is unambiguous on its own - the
    // object rule exists to separate the two «bekor qilish» meanings, and
    // annulment is not one of them.
    expect(uz.policies.transitions.annulled).toBe('Annulyatsiya qilish')
  })
})

describe('uz: «Bekor qilish» is reserved for domain actions', () => {
  it('the generic modal dismiss is «Yopish», not «Bekor qilish»', () => {
    expect(uz.common.cancel).toBe('Yopish')
    expect(uz.common.cancel.toLowerCase()).not.toContain('bekor')
  })

  it('no uz string says a bare «bekor qilish» with nothing to cancel', () => {
    const bare: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        // A domain action names its object; a status is the -gan participle.
        // Anything else that reaches for the verb is the collision we banned.
        if (/\bbekor qilish\b/i.test(node) && !/\S+ni\s+bekor qilish/i.test(node)) {
          bare.push(`${path}: ${node}`)
        }
        return
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          walk(value, path ? `${path}.${key}` : key)
        }
      }
    }
    walk(uz, '')
    expect(bare).toEqual([])
  })

  it('the domain verb is not borrowed for the "cannot be undone" idiom', () => {
    // «qaytarilmas» is this codebase's word for irreversible; «bekor qilib
    // bo‘lmaydi» would read as the cancellation/revocation action.
    expect(uz.requests.confirm.withdrawn).toContain('qaytarilmas')
    expect(uz.policies.transitionConfirm.cancelled).toContain('qaytarilmas')
    const flat = JSON.stringify(uz).toLowerCase()
    expect(flat).not.toContain('bekor qilib bo')
  })
})

describe('uz: claims vs loss', () => {
  it('the claims department is Sug‘urta da’volari', () => {
    expect(uz.nav.claims).toBe('Sug‘urta da’volari')
    expect(uz.roles.claims).toBe('Sug‘urta da’volari')
    expect(uz.roles.descriptions.claims).toContain('Sug‘urta da’volari')
  })

  it('accounting "loss" stays zarar and is not swapped for da’vo', () => {
    expect(uz.policies.terms.nql).toBe('Qoplanmaydigan zarar (NQL)')
    expect(uz.policies.terms.deductibleEachLoss).toContain('zarar')
    expect(uz.fin.sections.profitAndLoss).toContain('zarar')
  })
})

describe('uz: department role names (confirmed)', () => {
  it('keeps the dictated transliterations', () => {
    expect(uz.roles.sales).toBe('Sotuv')
    expect(uz.roles.commercial_underwriter).toBe('Tijorat anderrayteri')
    expect(uz.roles.credit_underwriter).toBe('Kredit anderrayteri')
    expect(uz.roles.information_manager).toBe('Axborot menejeri')
    expect(uz.roles.client).toBe('Mijoz')
  })
})
