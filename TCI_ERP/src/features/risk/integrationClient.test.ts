/**
 * What the policyholder may read of Prompt 31: nothing of sector grades,
 * country categories or sanctions. A refused write reaches them only as
 * «cover is not available for this buyer / country» — never the word
 * sanctions, never a regime.
 */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { CLIENT_COVER_KEYS, STAFF_COVER_KEYS, warningKey } from './integration'
import { SANCTION_REGIMES, SANCTION_SCOPES } from './rules'
import type { RiskWarning } from './rules'

const PORTAL = import.meta.glob(['../portal/*.ts', '../portal/*.tsx', '!../portal/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function lookup(locale: unknown, key: string): unknown {
  let node: unknown = locale
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** The words for sanctions and for a regime, in the three languages. */
const FORBIDDEN = /sanction|санкц|sanksiya|regime|режим|rejim/i
/** The regimes' own names, as whole words (Cyrillic included). */
const REGIMES = /(?:^|[^\p{L}])(?:OFAC|UN|EU|UK|ООН|ЕС|BMT|YeI)(?:[^\p{L}]|$)/u

describe('the client’s cover words', () => {
  for (const [lang, locale] of [
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const) {
    it(`exist and never name sanctions (${lang})`, () => {
      for (const key of Object.values(CLIENT_COVER_KEYS)) {
        const text = lookup(locale, key)
        expect(typeof text, `${lang}: ${key}`).toBe('string')
        expect(text as string, `${lang}: ${key}`).not.toMatch(FORBIDDEN)
        expect(text as string, `${lang}: ${key}`).not.toMatch(REGIMES)
      }
    })
  }
})

describe('the portal', () => {
  it('maps its limit writes through the client’s cover words', () => {
    const file = (name: string) => Object.entries(PORTAL).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? ''
    expect(file('RequestLimitModal.tsx')).toContain('clientCoverRefusal(err)')
    expect(file('ChangeLimitRequestModal.tsx')).toContain('clientRefusalOr(failure,')
    // the shared mapping would answer risk.errors.* (which name sanctions)
    expect(file('ChangeLimitRequestModal.tsx')).not.toMatch(/\brefusalOr\(/)
  })

  it('shows nothing of sector grades, country categories or sanctions', () => {
    for (const [path, text] of Object.entries(PORTAL)) {
      expect(text, path).not.toMatch(/from '\.\.\/risk\/(badges|api|integrationBadges|integrationDecision|integrationConcentration)'/)
      expect(text, path).not.toMatch(/['"`]risk\.(errors|sanctions|country|sector|decision|concentration|trace)\./)
    }
  })
})

/** i18next resolves a key with a count through its plural forms. */
function resolves(locale: unknown, key: string): boolean {
  return ['', '_one', '_other'].some((suffix) => typeof lookup(locale, key + suffix) === 'string')
}

describe('the keys the integration builds at run time', () => {
  const WARNINGS: RiskWarning[] = [
    { kind: 'sector_grade', grade: 'C' },
    { kind: 'sector_outlook' },
    { kind: 'sector_stale' },
    { kind: 'country_category', category: 6 },
    { kind: 'country_unclassified' },
    { kind: 'rank', required: 4, mine: 1 },
  ]
  const TRACE = [
    'sectorNoChange', 'sectorNotch', 'sectorCap', 'countryInactive', 'countryNoChange', 'countryCap',
    'countryNotch', 'capSector', 'capCountry', 'capBoth', 'country.oecd', 'country.internal',
    'country.unclassified', 'context.sector', 'context.noSector', 'context.countryInactive',
  ].map((k) => `risk.trace.${k}`)
  const keys = [
    ...WARNINGS.map((w) => warningKey(w).key),
    ...TRACE,
    ...SANCTION_SCOPES.map((s) => `risk.decision.scope.${s}`),
    ...SANCTION_REGIMES.map((r) => `risk.decision.regimes.${r}`),
    ...Object.values(STAFF_COVER_KEYS),
    'risk.concentration.blockedCompany',
    'risk.concentration.blockedCountry',
    'risk.concentration.hintPolicy',
    'risk.concentration.hintSubmission',
    'risk.concentration.emptyPolicy',
    'risk.concentration.emptySubmission',
    'risk.badges.compact.oecd',
    'risk.badges.compact.internal',
  ]
  for (const [lang, locale] of [
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const) {
    it(`exist in ${lang}`, () => {
      expect(keys.filter((k) => !resolves(locale, k))).toEqual([])
    })
  }
})
