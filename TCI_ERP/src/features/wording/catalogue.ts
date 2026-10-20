/**
 * The placeholders a wording template may use: `{{policy.number}}`,
 * `{{#limits}} … {{/limits}}` for the credit-limit schedule, and
 * `{{#policy.deductible}} … {{/policy.deductible}}` to print a clause only
 * when the value is set. Mirrors tci.wording_placeholder_catalogue()
 * (migration 0050), which refuses to activate a template that uses anything
 * else; catalogue.test.ts locks the two together.
 */

export const PLACEHOLDERS = [
  'insurer.name', 'insurer.legal_form', 'insurer.registration_number', 'insurer.tax_id',
  'insurer.license_number', 'insurer.license_date', 'insurer.country', 'insurer.address',
  'insurer.phone', 'insurer.email', 'insurer.website', 'insurer.bank_name', 'insurer.bank_account',
  'insurer.bank_code', 'insurer.signatory_name', 'insurer.signatory_title', 'insurer.signatory_basis',
  'policyholder.name', 'policyholder.legal_form', 'policyholder.registration_number',
  'policyholder.country', 'policyholder.address', 'policyholder.contact_person',
  'policyholder.email', 'policyholder.phone',
  'policy.number', 'policy.status', 'policy.product', 'policy.inception_date', 'policy.expiry_date',
  'policy.currency', 'policy.insured_percentage', 'policy.max_liability_amount',
  'policy.max_liability_multiple', 'policy.nql_amount', 'policy.deductible',
  'policy.aggregate_first_loss', 'policy.premium_rate', 'policy.minimum_premium',
  'policy.premium_basis', 'policy.estimated_turnover', 'policy.discretionary_limit',
  'policy.waiting_period_days', 'policy.max_extension_days', 'policy.max_payment_terms_days',
  'policy.declaration_frequency', 'policy.noa_window_days',
  'limits', 'limits.buyer_name', 'limits.buyer_country', 'limits.buyer_registration_number',
  'limits.amount', 'limits.currency', 'limits.payment_terms_days', 'limits.valid_from',
  'limits.valid_until',
  'document.date', 'document.language',
] as const

export type Placeholder = (typeof PLACEHOLDERS)[number]

const KNOWN = new Set<string>(PLACEHOLDERS)

export function isKnownPlaceholder(tag: string): boolean {
  return KNOWN.has(tag)
}

export const PLACEHOLDER_GROUPS = ['insurer', 'policyholder', 'policy', 'limits', 'document'] as const
export type PlaceholderGroup = (typeof PLACEHOLDER_GROUPS)[number]

export function placeholderGroup(tag: Placeholder): PlaceholderGroup {
  return tag.split('.')[0] as PlaceholderGroup
}

/** i18n key of a placeholder's description: "wording.placeholders.policy_number". */
export function placeholderKey(tag: Placeholder): string {
  return `wording.placeholders.${tag.replace(/\./g, '_')}`
}

/** How a placeholder is typed into a template. Inside the limits loop the
 *  item fields are written without the prefix: {{buyer_name}}. */
export function placeholderSyntax(tag: Placeholder): string {
  if (tag === 'limits') return '{{#limits}} … {{/limits}}'
  if (tag.startsWith('limits.')) return `{{${tag.slice('limits.'.length)}}}`
  return `{{${tag}}}`
}

/** Template syntax shown inside translated sentences. Passed to t() as
 *  values, because i18next would read a literal {{…}} in a translation as
 *  its own interpolation and print nothing. */
export const WORDING_SYNTAX = {
  braces: '{{…}}',
  example: '{{policy.number}}',
  insurerTag: '{{insurer.*}}',
  loopOpen: '{{#limits}}',
  loopClose: '{{/limits}}',
  condOpen: '{{#policy.deductible}}',
  condClose: '{{/policy.deductible}}',
} as const
