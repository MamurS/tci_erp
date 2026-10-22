/**
 * The commercial offer as a document — ONE component for the staff preview,
 * the portal viewer and the print route, so what a client prints is what
 * sales saw. Everything is in the OFFER's language (useFixedT), never the
 * screen's: an Uzbek offer opened by a Russian-speaking underwriter still
 * reads in Uzbek.
 *
 * What it prints comes from two places only: the version's texts (what staff
 * wrote) and its data (what the database composed). There is nothing else to
 * leak: no grade, engine limit, authority or comment ever reaches `data`.
 */

import type { TFunction } from 'i18next'

import { BRAND } from '../../lib/brand'
import { EM_DASH, formatDate, formatDocumentAmount, formatRate } from '../../lib/format'
import { BrochureBody } from '../brochure/BrochureBody'
import { useCountries } from '../entities/api'
import { DocBody } from '../contracts/DocRenderer'
import '../contracts/contractDoc.css'
import './offerDoc.css'
import type { BuyerBasis, OfferBlock, OfferData, OfferDocumentInput } from './model'
import { printableBlocks } from './texts'

const BASIS_STYLE: Record<BuyerBasis, string> = {
  approved: 'bg-pos-50 text-pos-500 ring-pos-500/25',
  indicative: 'bg-slate-100 text-slate-600 ring-slate-300',
  declined: 'bg-neg-50 text-neg-500 ring-neg-500/20',
}

function useNumbers(lang: string) {
  // Country names come from the reference table (as everywhere in the app),
  // in the DOCUMENT's language; Intl is the fallback for a code it lacks.
  const { data: countries } = useCountries()
  const money = (v: number | null | undefined, ccy?: string | null) =>
    v === null || v === undefined ? EM_DASH : `${formatDocumentAmount(v, lang)}${ccy ? ` ${ccy}` : ''}`
  const days = (v: number | null | undefined, t: TFunction) =>
    v === null || v === undefined ? EM_DASH : t('policies.terms.days', { count: v })
  const country = (code: string | null | undefined) => {
    if (!code) return EM_DASH
    const row = countries?.find((c) => c.code === code)
    const named = row && (lang === 'ru' ? row.name_ru : lang === 'uz' ? row.name_uz : row.name_en)
    if (named) return named
    try {
      return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code
    } catch {
      return code
    }
  }
  return { money, days, country }
}

function Section({ title, children, breakBefore }: { title: string; children: React.ReactNode; breakBefore?: boolean }) {
  return (
    <section className={`kp-section ${breakBefore ? 'kp-break-before' : ''}`}>
      <h2 className="kp-h2">{title}</h2>
      {children}
    </section>
  )
}

function Terms({ rows }: { rows: [string, string][] }) {
  return (
    <table className="kp-terms">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Cover({ input, t }: { input: OfferDocumentInput; t: TFunction }) {
  const { data } = input
  const issuer = data.insurer?.legal_name?.trim()
  return (
    <section className="kp-cover">
      <div className="kp-cover-band">
        {issuer ? (
          <span className="kp-issuer">{issuer}</span>
        ) : (
          <span className="kp-wordmark">
            <span className="text-accent-500">{BRAND.wordmark[0]}</span>
            <span>{BRAND.wordmark[1]}</span>
          </span>
        )}
      </div>
      <div className="kp-cover-body">
        <p className="kp-kicker">{t('offers.doc.kicker')}</p>
        <h1 className="kp-title">{t('offers.doc.title')}</h1>
        <p className="kp-client">{data.client.name}</p>
        <dl className="kp-cover-facts">
          <div>
            <dt>{t('offers.doc.number')}</dt>
            <dd className="font-mono">{input.offerNumber}{input.versionNo > 1 ? ` · v${input.versionNo}` : ''}</dd>
          </div>
          <div>
            <dt>{t('offers.doc.date')}</dt>
            <dd>{formatDate(input.date, input.language)}</dd>
          </div>
          <div>
            <dt>{t('offers.doc.validUntil')}</dt>
            <dd>{formatDate(input.validUntil, input.language)}</dd>
          </div>
          <div>
            <dt>{t('offers.doc.request')}</dt>
            <dd className="font-mono">{data.request.number}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

function coverRows(data: OfferData, lang: string, t: TFunction, n: ReturnType<typeof useNumbers>): [string, string][] {
  const tm = data.terms
  const ccy = tm.currency_code
  const pct = (v: number | null) => (v === null ? EM_DASH : `${formatDocumentAmount(v, lang, v % 1 ? 2 : 0)}%`)
  const rows: [string, string][] = [
    [t('policies.fields.productStructure'), tm.product_structure ? t(`policies.structures.${tm.product_structure}`) : EM_DASH],
    [t('policies.fields.currency'), ccy ?? EM_DASH],
    [t('policies.terms.insuredPercentage'), pct(tm.insured_percentage)],
    [
      t('policies.terms.maxLiability'),
      tm.max_liability_amount !== null
        ? n.money(tm.max_liability_amount, ccy)
        : tm.max_liability_premium_multiple !== null
          ? t('policies.terms.premiumMultiple', { value: tm.max_liability_premium_multiple })
          : EM_DASH,
    ],
    [t('policies.terms.discretionaryLimit'), n.money(tm.discretionary_limit, ccy)],
    [t('policies.terms.nql'), n.money(tm.nql_amount, ccy)],
  ]
  if (tm.deductible_each_loss !== null) rows.push([t('policies.terms.deductibleEachLoss'), n.money(tm.deductible_each_loss, ccy)])
  if (tm.aggregate_first_loss !== null) rows.push([t('policies.terms.aggregateFirstLoss'), n.money(tm.aggregate_first_loss, ccy)])
  rows.push(
    [t('policies.terms.waitingPeriod'), n.days(tm.waiting_period_days, t)],
    [t('policies.terms.maxExtensionPeriod'), n.days(tm.max_extension_period_days, t)],
    [t('policies.terms.maxPaymentTerms'), n.days(tm.max_payment_terms_days, t)],
    [
      t('policies.terms.declarationFrequency'),
      tm.declaration_frequency ? t(`policies.frequencies.${tm.declaration_frequency}`) : EM_DASH,
    ],
  )
  return rows
}

function premiumRows(data: OfferData, lang: string, t: TFunction, n: ReturnType<typeof useNumbers>): [string, string][] {
  const ccy = data.terms.currency_code
  const p = data.premium
  const rows: [string, string][] = [
    [t('policies.terms.premiumRate'), formatRate(p.rate_pct, lang)],
    [t('policies.terms.minimumPremium'), n.money(p.minimum_premium, ccy)],
  ]
  if (data.terms.estimated_annual_turnover !== null) {
    rows.push(
      [t('policies.terms.estimatedTurnover'), n.money(data.terms.estimated_annual_turnover, ccy)],
      [t('offers.doc.premium.estimated'), n.money(p.estimated_premium, ccy)],
    )
  }
  rows.push([t('offers.doc.premium.due'), n.money(p.estimated_premium_due, ccy)])
  if (p.instalments) {
    rows.push([
      t('offers.doc.premium.instalments'),
      t('offers.doc.premium.instalmentsValue', { count: p.instalments, amount: n.money(p.instalment_amount, ccy) }),
    ])
  }
  return rows
}

export function OfferDocument({ input, t, print = false }: { input: OfferDocumentInput; t: TFunction; print?: boolean }) {
  const lang = input.language
  const n = useNumbers(lang)
  const { data } = input
  const blocks = printableBlocks(input.texts)
  const block = (b: OfferBlock) =>
    blocks.includes(b) ? <DocBody doc={input.texts[b]!} plain /> : null
  const insurer = data.insurer
  const requisites: [string, string | null | undefined][] = insurer
    ? [
        [t('offers.doc.requisites.name'), [insurer.legal_form, insurer.legal_name].filter(Boolean).join(' ') || null],
        [t('offers.doc.requisites.registration'), insurer.registration_number],
        [t('offers.doc.requisites.taxId'), insurer.tax_id],
        [
          t('offers.doc.requisites.licence'),
          insurer.license_number
            ? insurer.license_date
              ? t('offers.doc.requisites.licenceValue', {
                  number: insurer.license_number,
                  date: formatDate(insurer.license_date, lang),
                })
              : insurer.license_number
            : null,
        ],
        [t('offers.doc.requisites.address'), insurer.address],
        [t('offers.doc.requisites.phone'), insurer.phone],
        [t('offers.doc.requisites.email'), insurer.email],
        [t('offers.doc.requisites.website'), insurer.website],
        [t('offers.doc.requisites.bank'), [insurer.bank_name, insurer.bank_account, insurer.bank_code].filter(Boolean).join(', ') || null],
      ]
    : []

  return (
    <div className={`kp-doc ${print ? 'kp-print' : ''}`} lang={lang}>
      <Cover input={input} t={t} />

      {blocks.includes('intro') && <section className="kp-section kp-letter">{block('intro')}</section>}

      {blocks.includes('why_tci') && <Section title={t('offers.doc.sections.whyTci')}>{block('why_tci')}</Section>}

      <Section title={t('offers.doc.sections.cover')}>
        <Terms rows={coverRows(data, lang, t, n)} />
      </Section>

      <Section title={t('offers.doc.sections.premium')}>
        <Terms rows={premiumRows(data, lang, t, n)} />
        <p className="kp-note">{t('offers.doc.premium.note')}</p>
      </Section>

      <Section title={t('offers.doc.sections.buyers')}>
        {data.buyers.length === 0 ? (
          <p className="kp-note">{t('offers.doc.buyers.none')}</p>
        ) : (
          <>
            <table className="kp-buyers">
              <colgroup>
                <col className="w-[23%]" />
                <col className="w-[15%]" />
                <col className="w-[16.5%]" />
                <col className="w-[16.5%]" />
                <col className="w-[11%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('offers.doc.buyers.buyer')}</th>
                  <th>{t('offers.doc.buyers.country')}</th>
                  <th className="kp-num">{t('offers.doc.buyers.requested')}</th>
                  <th className="kp-num">{t('offers.doc.buyers.offered')}</th>
                  <th className="kp-num">{t('offers.doc.buyers.terms')}</th>
                  <th>{t('offers.doc.buyers.basis')}</th>
                </tr>
              </thead>
              <tbody>
                {data.buyers.map((b, i) => (
                  <tr key={`${b.name}-${i}`}>
                    <td>{b.name}</td>
                    <td>{n.country(b.country_code)}</td>
                    <td className="kp-num">{n.money(b.requested_amount, b.currency_code)}</td>
                    <td className={b.basis === 'declined' ? 'kp-num kp-wrap' : 'kp-num'}>
                      {b.basis === 'declined' ? t('offers.doc.buyers.notOffered') : n.money(b.offered_amount, b.currency_code)}
                    </td>
                    <td className="kp-num">{n.days(b.offered_payment_terms_days, t)}</td>
                    <td>
                      <span className={`kp-basis ring-1 ring-inset ${BASIS_STYLE[b.basis]}`}>
                        {t(`offers.doc.buyers.bases.${b.basis}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="kp-note">{t('offers.doc.buyers.footnote')}</p>
          </>
        )}
      </Section>

      {blocks.includes('conditions') && <Section title={t('offers.doc.sections.conditions')}>{block('conditions')}</Section>}
      {blocks.includes('next_steps') && <Section title={t('offers.doc.sections.nextSteps')}>{block('next_steps')}</Section>}

      <Section title={t('offers.doc.sections.contacts')}>
        <div className="kp-contacts">
          <div>
            <h3 className="kp-h3">{t('offers.doc.contact.title')}</h3>
            <p>{data.contact.name ?? EM_DASH}</p>
            {data.contact.phone && <p>{data.contact.phone}</p>}
            {data.contact.email && <p>{data.contact.email}</p>}
            <p className="kp-note">{t('offers.doc.contact.portal')}</p>
          </div>
          {requisites.some(([, v]) => v) && (
            <div>
              <h3 className="kp-h3">{t('offers.doc.requisites.title')}</h3>
              <dl className="kp-requisites">
                {requisites
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </div>
      </Section>

      {input.brochure && input.brochure.sections.length > 0 && (
        <section className="kp-brochure kp-break-before">
          <BrochureBody content={input.brochure} lang={lang} print={print} />
        </section>
      )}
    </div>
  )
}
