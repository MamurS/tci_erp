import { describe, expect, it } from 'vitest'

import { defaultStatementCurrency } from './countryCurrency'

describe('defaultStatementCurrency', () => {
  it('preselects the country currency when the reference table has it', () => {
    expect(defaultStatementCurrency('RU', ['RUB', 'USD'])).toBe('RUB')
    expect(defaultStatementCurrency('DE', ['EUR'])).toBe('EUR')
  })
  it('leaves the choice alone otherwise', () => {
    expect(defaultStatementCurrency('VN', ['USD', 'UZS'])).toBeNull()
    expect(defaultStatementCurrency(null, ['UZS'])).toBeNull()
  })
})
