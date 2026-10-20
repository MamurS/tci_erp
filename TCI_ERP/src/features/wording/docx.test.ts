import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { buildWordingContext } from './context'
import type { MergeData } from './context'
import { flattenTags, inspectTemplate, renderTemplate } from './docx'

import EN from './defaults/policy-wording-en.docx?inline'
import RU from './defaults/policy-wording-ru.docx?inline'
import UZ from './defaults/policy-wording-uz.docx?inline'

const DEFAULTS: Record<string, string> = { en: EN, ru: RU, uz: UZ }

/** The shipped template's bytes (Vite inlines it as a data URL). */
const defaults = (lang: string): ArrayBuffer =>
  Uint8Array.from(atob(DEFAULTS[lang].split(',')[1]), (c) => c.charCodeAt(0)).buffer

const DATA: MergeData = {
  source: { kind: 'policy', id: 'p1' },
  insurer: { name: 'Insurer JSC', license_number: 'L-7', license_date: '2024-03-01', signatory_name: 'A. Karimov' },
  policyholder: { name: 'Holder LLC', registration_number: '305', country: 'UZ' },
  policy: {
    number: 'TCI-2026-001', product: 'whole_turnover', status: 'draft', inception_date: '2026-01-01',
    expiry_date: '2026-12-31', currency: 'USD', insured_percentage: 90, max_liability_amount: 1250000,
    nql_amount: 500, deductible: null, aggregate_first_loss: 20000, premium_rate: 0.15, minimum_premium: 10000,
    premium_basis: 'minimum_with_adjustment', discretionary_limit: 25000, waiting_period_days: 150,
    max_extension_days: 60, max_payment_terms_days: 90, declaration_frequency: 'monthly', noa_window_days: 30,
  },
  limits: [
    { buyer_name: 'Alpha GmbH', buyer_country: 'DE', buyer_registration_number: 'HRB 1', amount: 40000, currency: 'USD',
      payment_terms_days: 60, valid_from: '2026-01-01', valid_until: null },
    { buyer_name: 'Beta OOO', buyer_country: 'RU', buyer_registration_number: '7701', amount: 15000, currency: 'USD',
      payment_terms_days: 30, valid_from: '2026-02-01', valid_until: '2026-12-31' },
  ],
}

const LABELS = {
  enumLabel: (kind: string, value: string) => `${kind}:${value}`,
  countryName: (code: string) => `country:${code}`,
}

function text(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((b) => new PizZip(b).file('word/document.xml')?.asText() ?? '')
}

describe('docx templates', () => {
  for (const lang of ['ru', 'en', 'uz']) {
    it(`the standard ${lang} template parses and uses only catalogue placeholders`, () => {
      const result = inspectTemplate(defaults(lang))
      expect(result.error).toBeNull()
      expect(result.unknown).toEqual([])
      expect(result.placeholders).toContain('limits.buyer_name')
      expect(result.placeholders).toContain('policy.number')
    })
  }

  it('fills the standard template: values, the limits schedule row per buyer, conditional clauses', async () => {
    const context = buildWordingContext(DATA, 'ru', LABELS, new Date('2026-10-19T09:00:00Z'))
    const xml = await text(renderTemplate(defaults('ru'), context))
    expect(xml).toContain('TCI-2026-001')
    expect(xml).toMatch(/1\s250\s000,00/)
    expect(xml).toContain('Alpha GmbH')
    expect(xml).toContain('Beta OOO')
    expect(xml).toContain('product:whole_turnover')
    // the aggregate-first-loss clause is printed, the deductible clause is not
    expect(xml).toMatch(/20\s000,00/)
    expect(xml).not.toContain('Франшиза по каждому убытку')
    expect(xml).not.toContain('{{')
  })

  it('reports a broken template instead of throwing', () => {
    const zip = new PizZip(defaults('en'))
    const xml = zip.file('word/document.xml')?.asText() ?? ''
    zip.file('word/document.xml', xml.replace('{{policy.number}}', '{{policy.number'))
    const result = inspectTemplate(zip.generate({ type: 'arraybuffer' }))
    expect(result.error).toBeTruthy()
  })

  it('flattens tags: the limits loop scopes, other sections do not', () => {
    expect(
      flattenTags({
        'policy.number': {},
        limits: { buyer_name: {}, 'policy.currency': {} },
        'policy.deductible': { 'policy.deductible': {} },
        'policy.secret': {},
      }),
    ).toEqual(['limits', 'limits.buyer_name', 'policy.currency', 'policy.deductible', 'policy.number', 'policy.secret'])
  })
})
