/**
 * Invented offer data for the renderer's tests (unit and e2e) — never shown
 * to anyone and never written anywhere. Names end in «Example», contacts use
 * the reserved `.invalid` domain, phone numbers are zeros.
 */

import type { OfferData } from '../model'

export interface SampleOptions {
  /** How many buyers the package holds. */
  buyers?: number
  /** Long client and buyer names (to push the letter onto further pages). */
  long?: boolean
  /** Overrides of the client's name (an XSS probe, say). */
  clientName?: string
  /** Names in capitals — the widest text a registry holds. */
  shout?: boolean
}

export function sampleOfferData({ buyers = 6, long = false, clientName, shout = false }: SampleOptions = {}): OfferData {
  const data: OfferData = {
    client: {
      name:
        clientName ??
        (long
          ? 'Example Agrologistics and Export Trading Company Limited Liability Partnership Holding Group International'
          : 'Example Trading'),
      legal_form: 'LLC',
      registration_number: '301234567',
      country_code: 'UZ',
      address: 'Tashkent, Example district, Example avenue 107B, Business centre «Example», floor 9',
    },
    request: { number: 'IR-2026-0007' },
    terms: {
      product_structure: 'whole_turnover',
      currency_code: 'USD',
      insured_percentage: 90,
      max_liability_amount: 2_000_000,
      max_liability_premium_multiple: null,
      discretionary_limit: 50_000,
      nql_amount: 1_000,
      deductible_each_loss: 2_500,
      aggregate_first_loss: 10_000,
      waiting_period_days: 90,
      max_extension_period_days: 60,
      max_payment_terms_days: 120,
      declaration_frequency: 'monthly',
      estimated_annual_turnover: 12_000_000,
    },
    premium: {
      rate_pct: 0.18,
      minimum_premium: 18_000,
      estimated_premium: 21_600,
      estimated_premium_due: 21_600.5,
      instalments: 4,
      instalment_amount: 4_500,
    },
    buyers: Array.from({ length: buyers }, (_, i) => ({
      name: long
        ? `Example Buyer ${i + 1} International Industrial Holding Group Joint Stock Company of Central Asia`
        : `Example Buyer ${i + 1} ${i % 3 === 0 ? 'Industrial Holding Group JSC' : 'LLC'}`,
      country_code: ['KZ', 'RU', 'DE', 'AE', 'GB'][i % 5]!,
      requested_amount: i % 5 === 4 ? 12_500_000_000 : 100_000 + i * 2_500_000,
      requested_payment_terms_days: 60,
      basis: (['approved', 'indicative', 'approved', 'declined'] as const)[i % 4]!,
      offered_amount: i % 4 === 3 ? 0 : 100_000 + i * 2_000_000,
      offered_payment_terms_days: i % 4 === 3 ? null : 120,
      currency_code: 'USD',
    })),
    insurer: {
      legal_name: 'Example Insurance',
      legal_form: 'JSC',
      registration_number: '200000001',
      tax_id: '200000001',
      license_number: 'SF-0000',
      license_date: '2020-01-01',
      address: 'Tashkent, Example avenue 10',
      phone: '+998 00 000 00 00',
      email: 'tci@example.invalid',
      website: 'example.invalid',
      bank_name: 'Example Bank',
      bank_account: '20208000000000000001',
      bank_code: '00000',
    },
    contact: { name: 'Sales Manager', phone: '+998 00 000 00 01', email: 'sales@example.invalid' },
    composed_at: '2026-10-22T06:00:00Z',
  }
  if (shout) {
    data.client.name = data.client.name.toUpperCase()
    for (const b of data.buyers) b.name = b.name.toUpperCase()
  }
  return data
}

/** The countries of the sample, as tci.countries holds them. */
export const SAMPLE_COUNTRIES = [
  { code: 'KZ', name_en: 'Kazakhstan', name_ru: 'Казахстан', name_uz: 'Qozog‘iston' },
  { code: 'RU', name_en: 'Russia', name_ru: 'Россия', name_uz: 'Rossiya' },
  { code: 'DE', name_en: 'Germany', name_ru: 'Германия', name_uz: 'Germaniya' },
  { code: 'AE', name_en: 'United Arab Emirates', name_ru: 'Объединённые Арабские Эмираты', name_uz: 'Birlashgan Arab Amirliklari' },
  { code: 'GB', name_en: 'United Kingdom', name_ru: 'Великобритания', name_uz: 'Buyuk Britaniya' },
  { code: 'UZ', name_en: 'Uzbekistan', name_ru: 'Узбекистан', name_uz: 'O‘zbekiston' },
] as const
