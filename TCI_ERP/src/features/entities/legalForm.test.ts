import { describe, expect, it } from 'vitest'

import { countryFromLegalForm } from './legalForm'

describe('countryFromLegalForm', () => {
  it.each([
    ['ТОО «Алма Трейд»', 'KZ'],
    ['TOO Alma Trade', 'KZ'],
    ['ООО «Ромашка»', 'RU'],
    ['OOO Ozon Volga', 'RU'],
    ['АО Северсталь', 'RU'],
    ['PAO Gazprom Neft', 'RU'],
    ['MChJ Uzbek Textile', 'UZ'],
    ['Samarkand Textile MCHJ', 'UZ'],
    ['AJ "Uzmetkombinat"', 'UZ'],
    ['Berliner Textilhandel GmbH', 'DE'],
    ['Istanbul Tekstil A.Ş.', 'TR'],
    ['Polimex Sp. z o.o.', 'PL'],
    ['Holland Foods B.V.', 'NL'],
  ])('%s → %s', (name, country) => {
    expect(countryFromLegalForm(name)).toBe(country)
  })

  it('guesses nothing where the form is ambiguous or absent', () => {
    expect(countryFromLegalForm('Shanghai Huamei Trading Co., Ltd.')).toBeNull()
    expect(countryFromLegalForm('Acme LLC')).toBeNull()
    expect(countryFromLegalForm('Volgograd Steel')).toBeNull()
    expect(countryFromLegalForm('')).toBeNull()
  })

  it('needs a name after the form, and the form as a whole word', () => {
    expect(countryFromLegalForm('ООО')).toBeNull()
    expect(countryFromLegalForm('Aotearoa Dairy')).toBeNull()
    expect(countryFromLegalForm('Toomas Trading')).toBeNull()
    expect(countryFromLegalForm('GmbHaus Retail')).toBeNull()
  })
})
