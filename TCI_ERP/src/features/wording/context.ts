/**
 * Turns the merge data tci.wording_merge_data() returns (raw numbers, ISO
 * dates, enum codes) into the values a template prints, in the TEMPLATE's
 * language — a Russian template gets "1 250 000,00" and "19 октября 2026 г.",
 * an English one "1,250,000.00". Pure: no I/O, labels come in as functions.
 * Missing values print as nothing (not "—"): a blank in a draft contract is
 * a gap to fill, and a section tag like {{#policy.deductible}} disappears.
 */

import { formatAmount, formatLongDate } from '../../lib/format'

export interface MergeLimit {
  buyer_name: string | null
  buyer_country: string | null
  buyer_registration_number: string | null
  amount: number | null
  currency: string | null
  payment_terms_days: number | null
  valid_from: string | null
  valid_until: string | null
}

export interface MergeData {
  source: { kind: 'policy' | 'submission'; id: string }
  insurer: Record<string, string | null> | null
  policyholder: Record<string, string | null> | null
  policy: Record<string, string | number | null>
  limits: MergeLimit[]
}

export interface ContextLabels {
  /** Enum label in the template language, e.g. ("product", "whole_turnover"). */
  enumLabel: (kind: 'product' | 'status' | 'frequency' | 'premium_basis', value: string) => string
  countryName: (code: string) => string
}

/** The formatting locale for a template language: en, ru and uz have their
 *  own conventions; any other language is printed the international way. */
export function wordingLocale(language: string): 'en' | 'ru' | 'uz' {
  return language === 'ru' || language === 'uz' ? language : 'en'
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

function money(v: unknown, locale: string): string {
  return typeof v === 'number' || (typeof v === 'string' && v !== '')
    ? formatAmount(Number(v), locale, 2)
    : ''
}

function whole(v: unknown, locale: string): string {
  return typeof v === 'number' || (typeof v === 'string' && v !== '') ? formatAmount(Number(v), locale, 0) : ''
}

/** A percentage stored as a percent number (90, 0.15): printed as entered. */
function percent(v: unknown, locale: string): string {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  const decimals = Math.min(5, (String(n).split('.')[1] ?? '').length)
  return `${formatAmount(n, locale, decimals)}%`
}

function date(v: unknown, locale: string): string {
  return typeof v === 'string' && v ? formatLongDate(`${v}T12:00:00Z`, locale) : ''
}

export function buildWordingContext(
  data: MergeData,
  language: string,
  labels: ContextLabels,
  today: Date = new Date(),
): Record<string, unknown> {
  const locale = wordingLocale(language)
  const p = data.policy
  const insurer = data.insurer ?? {}
  const holder = data.policyholder ?? {}
  const enumOr = (kind: Parameters<ContextLabels['enumLabel']>[0], v: unknown) =>
    v === null || v === undefined || v === '' ? '' : labels.enumLabel(kind, String(v))
  const country = (v: unknown) => (v ? labels.countryName(String(v)) : '')

  return {
    insurer: {
      name: text(insurer.name),
      legal_form: text(insurer.legal_form),
      registration_number: text(insurer.registration_number),
      tax_id: text(insurer.tax_id),
      license_number: text(insurer.license_number),
      license_date: date(insurer.license_date, locale),
      country: country(insurer.country),
      address: text(insurer.address),
      phone: text(insurer.phone),
      email: text(insurer.email),
      website: text(insurer.website),
      bank_name: text(insurer.bank_name),
      bank_account: text(insurer.bank_account),
      bank_code: text(insurer.bank_code),
      signatory_name: text(insurer.signatory_name),
      signatory_title: text(insurer.signatory_title),
      signatory_basis: text(insurer.signatory_basis),
    },
    policyholder: {
      name: text(holder.name),
      legal_form: text(holder.legal_form),
      registration_number: text(holder.registration_number),
      country: country(holder.country),
      address: text(holder.address),
      contact_person: text(holder.contact_person),
      email: text(holder.email),
      phone: text(holder.phone),
    },
    policy: {
      number: text(p.number),
      status: enumOr('status', p.status),
      product: enumOr('product', p.product),
      inception_date: date(p.inception_date, locale),
      expiry_date: date(p.expiry_date, locale),
      currency: text(p.currency),
      insured_percentage: percent(p.insured_percentage, locale),
      max_liability_amount: money(p.max_liability_amount, locale),
      max_liability_multiple: p.max_liability_multiple === null || p.max_liability_multiple === undefined
        ? ''
        : formatAmount(Number(p.max_liability_multiple), locale, 2),
      nql_amount: money(p.nql_amount, locale),
      deductible: money(p.deductible, locale),
      aggregate_first_loss: money(p.aggregate_first_loss, locale),
      premium_rate: percent(p.premium_rate, locale),
      minimum_premium: money(p.minimum_premium, locale),
      premium_basis: enumOr('premium_basis', p.premium_basis),
      estimated_turnover: money(p.estimated_turnover, locale),
      discretionary_limit: money(p.discretionary_limit, locale),
      waiting_period_days: whole(p.waiting_period_days, locale),
      max_extension_days: whole(p.max_extension_days, locale),
      max_payment_terms_days: whole(p.max_payment_terms_days, locale),
      declaration_frequency: enumOr('frequency', p.declaration_frequency),
      noa_window_days: whole(p.noa_window_days, locale),
    },
    limits: data.limits.map((l) => ({
      buyer_name: text(l.buyer_name),
      buyer_country: country(l.buyer_country),
      buyer_registration_number: text(l.buyer_registration_number),
      amount: money(l.amount, locale),
      currency: text(l.currency),
      payment_terms_days: whole(l.payment_terms_days, locale),
      valid_from: date(l.valid_from, locale),
      valid_until: date(l.valid_until, locale),
    })),
    document: {
      date: formatLongDate(today, locale),
      language,
    },
  }
}
