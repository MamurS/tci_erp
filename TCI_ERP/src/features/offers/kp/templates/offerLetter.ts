/**
 * The offer letter: the page right after the brochure cover, laid out as an
 * inner page of the brochure (navy header with the insurer's contacts,
 * margins, legal line) but WITHOUT a printed page number — the brochure
 * numbers its own pages, as in the ДМС offer.
 *
 * Everything on it comes from the version's DATA, composed by the database
 * (tci.offer_merge_data): the client, the proposed terms, the premium
 * estimate and instalments, the buyer limits marked approved / indicative /
 * declined, the contact. Never a grade, an engine limit, an authority or an
 * internal comment — the data does not carry them. The one free text is the
 * client note, plain and escaped.
 *
 * PAGINATION. A page is a fixed 794 × 1123 box, so nothing may overflow it.
 * The letter is a list of blocks with a CONSERVATIVE height estimate each;
 * they are packed onto pages in order, the buyer table row by row: when the
 * rows do not fit, the table continues on a further letter page with the same
 * header, «продолжение» in the title and the column heads repeated. The e2e
 * suite proves on extreme data in ru / en / uz that no page's content area
 * overflows (`data-kp-body` scrollHeight ≤ clientHeight).
 */

import {
  docAmount,
  docDate,
  docDays,
  docMoney,
  docPercent,
  docRate,
  EM_DASH,
  text,
  type DocLang,
} from '../format'
import type { OfferBuyer, OfferData } from '../../model'
import { body, C, caption, e, FONT_DISPLAY, HEADER_H, headerBar, legalLine, LETTER_FOOT_H, MARGIN, pageBox, PAGE_H, PAGE_W } from './shared'
import { LETTER_TEXTS, type LetterTexts } from './letterTexts'

export interface LetterContext {
  lang: DocLang
  offerNumber: string
  versionNo: number
  /** The offer's date (ISO date or timestamp). */
  date: string
  validUntil: string
  data: OfferData
  /** Plain text, already normalised (params.normaliseNote). */
  note: string
  includeBrochure: boolean
  /** Country names in the document's language, by ISO code. */
  countries: Readonly<Record<string, string>>
}

// ---------------------------------------------------------------------------
// Geometry (px). Estimates err on the large side: a page that ends a little
// early is fine, a page that overflows is not.
// ---------------------------------------------------------------------------

const BODY_PAD_TOP = 34
const GAP = 16
/** Height available to the blocks of one letter page. */
export const LETTER_CAPACITY = PAGE_H - HEADER_H - LETTER_FOOT_H - BODY_PAD_TOP
const CONTENT_W = PAGE_W - 2 * MARGIN

/** Lines a text takes at about `perLine` characters a line — fewer per line
 * for text in capitals (a name typed in upper case is about a third wider). */
const lines = (value: string, perLine: number) => {
  const letters = value.replace(/[^\p{L}]/gu, '')
  const upper = letters ? letters.replace(/[^\p{Lu}]/gu, '').length / letters.length : 0
  const per = Math.max(4, Math.floor(perLine * (1 - 0.35 * upper)))
  return value.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / per)), 0)
}

const COLS = { buyer: 166, country: 108, requested: 106, offered: 106, terms: 72, basis: 124 } as const
const ROW_LINE = 17
const ROW_PAD = 15

/** An amount in the table: digits never split (NBSP groups), the currency
 * may drop to a second line in a narrow column. */
function tableMoney(v: unknown, lang: DocLang, ccy: unknown): string {
  const amount = docAmount(v, lang)
  const code = text(ccy)
  return amount !== EM_DASH && code ? `${amount} ${code}` : amount
}

/** ~13 characters of a 12 px amount fit the 96 px of an amount column. */
const amountLines = (value: string) => (value.length > 13 ? 2 : 1)

function buyerRowHeight(b: OfferBuyer, country: string, lang: DocLang): number {
  const nameLines = lines(text(b.name) ?? EM_DASH, 22)
  const countryLines = lines(country, 13)
  const money = Math.max(
    amountLines(tableMoney(b.requested_amount, lang, b.currency_code)),
    amountLines(tableMoney(b.offered_amount, lang, b.currency_code)),
  )
  return Math.max(nameLines, countryLines, money, 1) * ROW_LINE + ROW_PAD
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'html'; html: string; height: number }
  | { kind: 'table'; rows: OfferBuyer[]; continued: boolean; last: boolean }

const H = (html: string, height: number): Block => ({ kind: 'html', html, height })

function titleBlock(t: LetterTexts, ctx: LetterContext): Block {
  const number = ctx.versionNo > 1 ? `${ctx.offerNumber} · v${ctx.versionNo}` : ctx.offerNumber
  const cell = (label: string, value: string) =>
    `<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">${caption(label)}<div style="font-size: 16px; line-height: 22px; font-weight: 600; color: ${C.navy}; overflow-wrap: anywhere;">${e(value)}</div></div>`
  return H(
    `<div style="display: flex; flex-direction: column; gap: 12px;">
  <div style="width: 56px; height: 5px; background: ${C.orange};"></div>
  <h1 style="margin: 0; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 38px; line-height: 42px; color: ${C.navy};">${e(t.title)}</h1>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">${cell(t.number, number)}${cell(t.date, docDate(ctx.date, ctx.lang))}${cell(t.validUntil, docDate(ctx.validUntil, ctx.lang))}</div>
</div>`,
    // rule 5 + 12 + h1 42 + 12 + caption 15 + 4 + value 22, and a margin
    5 + 12 + 42 + 12 + 15 + 4 + 22 + 6,
  )
}

function continuedTitle(t: LetterTexts, ctx: LetterContext): Block {
  return H(
    `<div style="display: flex; align-items: center; gap: 14px;"><div style="background: ${C.navy}; color: ${C.white}; font-family: ${FONT_DISPLAY}; font-size: 15px; font-weight: 700; letter-spacing: 0.18em; padding: 4px 14px;">TCI</div><div style="font-family: ${FONT_DISPLAY}; font-size: 24px; line-height: 30px; font-weight: 700; color: ${C.navy};">${e(t.title)} ${e(ctx.offerNumber)} — ${e(t.continued)}</div></div>`,
    40,
  )
}

function partiesBlock(t: LetterTexts, ctx: LetterContext): Block {
  const d = ctx.data
  const name = [text(d.client?.legal_form), text(d.client?.name)].filter(Boolean).join(' ') || EM_DASH
  const reg = text(d.client?.registration_number)
  const address = text(d.client?.address)
  const row = (label: string, value: string) =>
    `<div style="display: flex; justify-content: space-between; gap: 12px;"><span style="font-size: 13px; color: ${C.muted};">${e(label)}</span><span style="font-size: 14px; font-weight: 600; color: ${C.navy}; text-align: right; overflow-wrap: anywhere;">${e(value)}</span></div>`
  const structure = d.terms?.product_structure ? t.structures[d.terms.product_structure] ?? EM_DASH : EM_DASH
  const left = `<div style="background: ${C.orangeTint}; border-radius: 0 24px 0 0; padding: 14px 20px; display: flex; flex-direction: column; gap: 6px; min-width: 0;">${caption(t.to)}<div data-kp-client style="font-family: ${FONT_DISPLAY}; font-size: 20px; font-weight: 700; line-height: 24px; color: ${C.navy}; overflow-wrap: anywhere;">${e(name)}</div>${reg ? `<div style="font-size: 13px; line-height: 18px; color: ${C.muted};">${e(t.registration)} ${e(reg)}</div>` : ''}${address ? `<div style="font-size: 12.5px; line-height: 18px; color: ${C.muted}; overflow-wrap: anywhere;">${e(address)}</div>` : ''}</div>`
  const right = `<div style="background: ${C.white}; border: 1px solid ${C.line}; border-radius: 0 24px 0 0; padding: 14px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0;">${row(t.structure, structure)}${row(t.currency, text(d.terms?.currency_code) ?? EM_DASH)}${row(t.request, text(d.request?.number) ?? EM_DASH)}</div>`
  // padding 28, caption 15 + gaps 6 each, the name at ~27 characters a line
  // of 24 px, the registration line, the address at ~40 characters a line
  const height = 28 + 15 + 6 + lines(name, 27) * 24 + (reg ? 6 + 18 : 0) + (address ? 6 + lines(address, 44) * 18 : 0) + 4
  return H(
    `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch;">${left}${right}</div>`,
    Math.max(height, 130),
  )
}

/** A titled grid of label / value pairs, three to a row. */
function factsGrid(title: string, facts: [string, string][], tint: string): { html: string; height: number } {
  const cells = facts
    .map(
      ([label, value]) =>
        `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;"><div style="font-size: 12px; line-height: 16px; color: ${C.muted};">${e(label)}</div><div style="font-size: 15px; line-height: 21px; font-weight: 600; color: ${C.ink}; overflow-wrap: anywhere;">${e(value)}</div></div>`,
    )
    .join('')
  const html = `<div style="display: flex; flex-direction: column; gap: 10px;"><div style="font-family: ${FONT_DISPLAY}; font-size: 22px; line-height: 26px; font-weight: 700; color: ${C.navy};">${e(title)}</div><div style="background: ${tint}; padding: 14px 18px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 20px; row-gap: 10px;">${cells}</div></div>`
  // A cell is its label (16 px a line, ~30 characters in a third of the
  // width) over its value (21 px a line, ~22 characters); a row is its
  // tallest cell, rows are 10 px apart, the tint pads 14 px top and bottom.
  let rowsHeight = 0
  for (let i = 0; i < facts.length; i += 3) {
    const row = facts.slice(i, i + 3)
    rowsHeight += Math.max(...row.map(([l, v]) => lines(l, 28) * 16 + 2 + lines(v, 22) * 21))
  }
  const rows = Math.ceil(facts.length / 3)
  const height = 26 + 10 + 28 + rowsHeight + (rows - 1) * 10 + 8
  return { html, height }
}

function termsBlock(t: LetterTexts, ctx: LetterContext): Block {
  const tm = ctx.data.terms
  const lang = ctx.lang
  const ccy = tm?.currency_code
  const facts: [string, string][] = [
    [t.insuredPercentage, docPercent(tm?.insured_percentage, lang)],
    [
      t.maxLiability,
      typeof tm?.max_liability_amount === 'number'
        ? docMoney(tm.max_liability_amount, lang, ccy)
        : typeof tm?.max_liability_premium_multiple === 'number'
          ? t.premiumMultiple(docAmount(tm.max_liability_premium_multiple, lang))
          : EM_DASH,
    ],
    [t.discretionaryLimit, docMoney(tm?.discretionary_limit, lang, ccy)],
    [t.nql, docMoney(tm?.nql_amount, lang, ccy)],
  ]
  if (typeof tm?.deductible_each_loss === 'number') facts.push([t.deductibleEachLoss, docMoney(tm.deductible_each_loss, lang, ccy)])
  if (typeof tm?.aggregate_first_loss === 'number') facts.push([t.aggregateFirstLoss, docMoney(tm.aggregate_first_loss, lang, ccy)])
  facts.push(
    [t.waitingPeriod, docDays(tm?.waiting_period_days, lang)],
    [t.maxExtensionPeriod, docDays(tm?.max_extension_period_days, lang)],
    [t.maxPaymentTerms, docDays(tm?.max_payment_terms_days, lang)],
    [t.declarationFrequency, tm?.declaration_frequency ? t.frequencies[tm.declaration_frequency] ?? EM_DASH : EM_DASH],
  )
  const g = factsGrid(t.termsTitle, facts, C.tint)
  return H(g.html, g.height)
}

function premiumBlock(t: LetterTexts, ctx: LetterContext): Block {
  const p = ctx.data.premium
  const lang = ctx.lang
  const ccy = ctx.data.terms?.currency_code
  const facts: [string, string][] = [
    [t.premiumRate, docRate(p?.rate_pct, lang)],
    [t.minimumPremium, docMoney(p?.minimum_premium, lang, ccy)],
  ]
  if (typeof ctx.data.terms?.estimated_annual_turnover === 'number') {
    facts.push(
      [t.estimatedTurnover, docMoney(ctx.data.terms.estimated_annual_turnover, lang, ccy)],
      [t.estimatedPremium, docMoney(p?.estimated_premium, lang, ccy)],
    )
  }
  if (typeof p?.instalments === 'number' && p.instalments > 0) {
    facts.push([t.instalments, t.instalmentsValue(p.instalments, docMoney(p.instalment_amount, lang, ccy))])
  }
  const g = factsGrid(t.premiumTitle, facts, C.tint)
  const due = `<div style="background: ${C.navy}; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; gap: 20px;"><div style="font-size: 14px; line-height: 20px; color: ${C.white};">${e(t.premiumDue)}</div><div data-kp-premium-due style="flex-shrink: 0; font-family: ${FONT_DISPLAY}; font-size: 26px; line-height: 32px; font-weight: 700; color: ${C.white}; white-space: nowrap;"><span style="display: inline-block; width: 10px; height: 10px; background: ${C.orange}; margin-right: 10px; vertical-align: middle;"></span>${e(docMoney(p?.estimated_premium_due, lang, ccy))}</div></div>`
  const note = `<div style="font-size: 11px; line-height: 16px; color: ${C.muted};">${e(t.premiumNote)}</div>`
  // the due strip: two lines of its 14 px label at most, or the figure
  const dueHeight = 24 + Math.max(lines(t.premiumDue, 52) * 20, 32)
  return H(
    `<div style="display: flex; flex-direction: column; gap: 8px;">${g.html}${due}${note}</div>`,
    g.height + 8 + dueHeight + 8 + lines(t.premiumNote, 110) * 16 + 4,
  )
}

const BASIS_STYLE: Record<OfferBuyer['basis'], { bg: string; fg: string }> = {
  approved: { bg: C.posTint, fg: C.pos },
  indicative: { bg: C.neutralTint, fg: C.muted },
  declined: { bg: C.negTint, fg: C.neg },
}

function countryName(ctx: LetterContext, code: string | null): string {
  const c = text(code)
  if (!c) return EM_DASH
  return text(ctx.countries[c]) ?? c
}

function tableHtml(t: LetterTexts, ctx: LetterContext, rows: OfferBuyer[], continued: boolean, last: boolean): string {
  const lang = ctx.lang
  const th = (label: string, align: 'left' | 'right' = 'left') =>
    `<th style="padding: 7px 5px; font-size: 10.5px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${C.white}; background: ${C.navy}; text-align: ${align}; vertical-align: bottom;">${e(label)}</th>`
  const td = `padding: 7px 5px; font-size: 12px; line-height: 17px; color: ${C.ink}; border-bottom: 1px solid ${C.line}; vertical-align: top;`
  const num = `${td} text-align: right; font-variant-numeric: tabular-nums;`
  const body = rows
    .map((b) => {
      const s = BASIS_STYLE[b.basis] ?? BASIS_STYLE.indicative
      const offered = b.basis === 'declined' ? EM_DASH : tableMoney(b.offered_amount, lang, b.currency_code)
      return `<tr data-kp-buyer><td style="${td} overflow-wrap: anywhere;">${e(text(b.name) ?? EM_DASH)}</td><td style="${td} overflow-wrap: break-word;">${e(countryName(ctx, b.country_code))}</td><td style="${num}">${e(tableMoney(b.requested_amount, lang, b.currency_code))}</td><td style="${num} font-weight: 600;">${e(offered)}</td><td style="${num} white-space: nowrap;">${e(docDays(b.offered_payment_terms_days, lang))}</td><td style="${td}"><span style="display: inline-block; background: ${s.bg}; color: ${s.fg}; font-size: 10.5px; font-weight: 600; line-height: 15px; padding: 1px 5px; white-space: nowrap;">${e(t.bases[b.basis] ?? b.basis)}</span></td></tr>`
    })
    .join('')
  const cols = Object.values(COLS)
    .map((w) => `<col style="width: ${w}px;">`)
    .join('')
  const title = continued ? `${t.buyersTitle} — ${t.continued}` : t.buyersTitle
  return `<div style="display: flex; flex-direction: column; gap: 10px;"><div style="font-family: ${FONT_DISPLAY}; font-size: 22px; font-weight: 700; color: ${C.navy};">${e(title)}</div><table style="width: ${CONTENT_W}px; border-collapse: collapse; table-layout: fixed;"><colgroup>${cols}</colgroup><thead><tr>${th(t.buyer)}${th(t.country)}${th(t.requested, 'right')}${th(t.offered, 'right')}${th(t.paymentTerms, 'right')}${th(t.basis)}</tr></thead><tbody>${body}</tbody></table>${last ? `<div style="font-size: 11.5px; line-height: 1.45; color: ${C.muted};">${e(t.buyersFootnote)}</div>` : ''}</div>`
}

/** Height of the table's fixed part: its title, the column heads (two lines
 * of an uppercase head in the narrow columns) and the gap. */
const TABLE_HEAD_H = 30 + 10 + 44
const footnoteHeight = (t: LetterTexts) => 10 + lines(t.buyersFootnote, 100) * 18

function contactBlock(t: LetterTexts, ctx: LetterContext): Block | null {
  const c = ctx.data.contact
  const values = [text(c?.name), text(c?.phone), text(c?.email)].filter((v): v is string => v !== null)
  const note = ctx.note.trim()
  if (!values.length && !note) return null
  const contact = values.length
    ? `<div style="border-left: 4px solid ${C.orange}; padding: 2px 0 2px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0;">${caption(t.contactTitle)}${values
        .map(
          (v, i) =>
            `<div style="font-size: ${i === 0 ? 16 : 14}px; font-weight: ${i === 0 ? 600 : 400}; color: ${i === 0 ? C.navy : C.ink}; overflow-wrap: anywhere;">${e(v)}</div>`,
        )
        .join('')}</div>`
    : ''
  const noteHtml = note
    ? `<div data-kp-note style="background: ${C.tint}; padding: 14px 18px; display: flex; flex-direction: column; gap: 6px; min-width: 0;">${caption(t.noteTitle)}<div style="font-size: 14px; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere;">${e(note)}</div></div>`
    : ''
  const html = note && values.length
    ? `<div style="display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 20px; align-items: start;">${contact}${noteHtml}</div>`
    : contact || noteHtml
  // The note is free text: assume the widest letters (a line of «Ш» is a third
  // shorter than one of ordinary words).
  const noteHeight = note ? 30 + 22 + lines(note, values.length ? 33 : 52) * 21 : 0
  const contactHeight = values.length ? 24 + values.length * 24 + lines(values.join(' '), 60) * 4 : 0
  return H(html, Math.max(noteHeight, contactHeight))
}

function closingBlock(t: LetterTexts, ctx: LetterContext): Block {
  const more = ctx.includeBrochure
    ? `<div style="background: ${C.orangeTint}; color: ${C.navy}; font-size: 15px; font-weight: 600; padding: 13px 20px;">${e(t.more)} →</div>`
    : ''
  return H(
    `<div style="display: flex; flex-direction: column; gap: 10px;">${more}<div style="font-size: 13px; color: ${C.muted};">${e(t.portal)}</div></div>`,
    (ctx.includeBrochure ? 50 + 10 : 0) + 22,
  )
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** The blocks of each letter page, in order. Pure: the tests drive it. */
export function paginateLetter(ctx: LetterContext): Block[][] {
  const t = LETTER_TEXTS[ctx.lang]
  const pages: Block[][] = []
  let page: Block[] = [titleBlock(t, ctx)]
  let used = (page[0] as Extract<Block, { kind: 'html' }>).height

  const fits = (h: number) => used + GAP + h <= LETTER_CAPACITY
  const newPage = () => {
    pages.push(page)
    const head = continuedTitle(t, ctx)
    page = [head]
    used = (head as Extract<Block, { kind: 'html' }>).height
  }
  // A block that does not fit moves to a new page — unless the page holds
  // nothing but its title yet, where it stays (it cannot fit anywhere better).
  const place = (b: Extract<Block, { kind: 'html' }>) => {
    if (!fits(b.height) && page.length > 1) newPage()
    page.push(b)
    used += GAP + b.height
  }

  place(partiesBlock(t, ctx) as Extract<Block, { kind: 'html' }>)
  place(termsBlock(t, ctx) as Extract<Block, { kind: 'html' }>)
  place(premiumBlock(t, ctx) as Extract<Block, { kind: 'html' }>)

  // What follows the buyer table: the contact (and note) and the closing
  // lines. They are kept with the table's last rows — never alone on a page.
  // One block, so the closing lines never part from the contact either.
  const contact = contactBlock(t, ctx) as Extract<Block, { kind: 'html' }> | null
  const closing = closingBlock(t, ctx) as Extract<Block, { kind: 'html' }>
  const tail: Extract<Block, { kind: 'html' }>[] = [
    contact
      ? H(
          `<div style="display: flex; flex-direction: column; gap: ${GAP}px;">${contact.html}${closing.html}</div>`,
          contact.height + GAP + closing.height,
        ) as Extract<Block, { kind: 'html' }>
      : closing,
  ]
  const tailHeight = tail.reduce((sum, b) => sum + GAP + b.height, 0)

  const buyers = ctx.data.buyers ?? []
  if (buyers.length === 0) {
    place(
      H(
        `<div style="display: flex; flex-direction: column; gap: 10px;"><div style="font-family: ${FONT_DISPLAY}; font-size: 22px; font-weight: 700; color: ${C.navy};">${e(t.buyersTitle)}</div><div style="font-size: 14px; color: ${C.muted};">${e(t.noBuyers)}</div></div>`,
        70,
      ) as Extract<Block, { kind: 'html' }>,
    )
  } else {
    const heights = buyers.map((b) => buyerRowHeight(b, countryName(ctx, b.country_code), ctx.lang))
    const foot = footnoteHeight(t)
    let i = 0
    let continued = false
    while (i < buyers.length) {
      // Start the table here only if the head and at least one row fit
      // (with the footnote, when that row is the last).
      const firstNeeds = TABLE_HEAD_H + heights[i]! + (i === buyers.length - 1 ? foot : 0)
      if (!fits(firstNeeds) && page.length > 1) {
        newPage()
        continued = continued || i > 0
      }
      let h = TABLE_HEAD_H
      const start = i
      while (i < buyers.length) {
        const isLast = i === buyers.length - 1
        const need = heights[i]! + (isLast ? foot : 0)
        if (i > start && !fits(h + need)) break
        h += heights[i]!
        i++
      }
      let last = i === buyers.length
      // Keep-with: when the table ends here but what follows it does not fit,
      // carry the last two rows over so they open the next page with it.
      if (last && !fits(h + foot + tailHeight) && i - start >= 3) {
        i -= 2
        h -= heights[i]! + heights[i + 1]!
        last = false
      }
      if (last) h += foot
      page.push({ kind: 'table', rows: buyers.slice(start, i), continued, last })
      used += GAP + h
      if (!last) {
        newPage()
        continued = true
      }
    }
  }

  for (const b of tail) place(b)
  pages.push(page)
  return pages
}

/** The letter's pages as HTML. */
export function offerLetterPages(ctx: LetterContext): string[] {
  const t = LETTER_TEXTS[ctx.lang]
  return paginateLetter(ctx).map((blocks, n) => {
    const content = blocks
      .map((b) => (b.kind === 'html' ? b.html : tableHtml(t, ctx, b.rows, b.continued, b.last)))
      .join('')
    return pageBox(
      `${headerBar(ctx.lang, ctx.data)}${body(content, { pad: `${BODY_PAD_TOP}px ${MARGIN}px 0`, gap: GAP, foot: LETTER_FOOT_H })}${legalLine(ctx.lang, ctx.data)}`,
      { attrs: `data-kp-letter="${n + 1}"` },
    )
  })
}
