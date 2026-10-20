/** The usual reporting currency of a country's statutory accounts, used only
 *  to PRESELECT the currency of a new statement on the country's national
 *  form (the analyst can always change it). ISO 4217 by ISO 3166 alpha-2. */

const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'PT', 'SI', 'SK']

const BY_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, 'EUR'])),
  UZ: 'UZS', RU: 'RUB', KZ: 'KZT', BY: 'BYN', UA: 'UAH', KG: 'KGS', TJ: 'TJS', TM: 'TMT', AZ: 'AZN',
  AM: 'AMD', GE: 'GEL', MD: 'MDL', MN: 'MNT', NP: 'NPR', CN: 'CNY', JP: 'JPY', KR: 'KRW', IN: 'INR',
  TR: 'TRY', BR: 'BRL', VN: 'VND', US: 'USD', PR: 'USD', GB: 'GBP', CH: 'CHF', LI: 'CHF', AE: 'AED',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', DK: 'DKK', SE: 'SEK', NO: 'NOK', IS: 'ISK',
}

/** The country's currency when the reference table carries it, else null. */
export function defaultStatementCurrency(countryCode: string | null | undefined, available: readonly string[]): string | null {
  const code = countryCode ? BY_COUNTRY[countryCode] : undefined
  return code && available.includes(code) ? code : null
}
