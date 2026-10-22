/**
 * The TCI brochure: a fixed A4 layout (794 × 1123 px, inline styles, no
 * scripts, no event handlers) in the TCI interface colours and faces, in the
 * visual language of the ДМС GOLD brochure — a navy header bar with the
 * insurer's contacts, condensed headlines, tinted cards with one rounded
 * corner, numbered steps, a geometric mosaic on the cover and a contacts page.
 *
 * Nine pages: 1 cover (three variants: white, navy, blue), 2 what TCI is,
 * 3 how it works (diagram), 4 what is covered, 5 benefits, 6 credit limits,
 * 7 from request to policy, 8 FAQ, 9 contacts. The words are TCI_TEXTS
 * (approved, hash-pinned); the only dynamic values are the insurer's
 * particulars, the manager's contact, the client's name and the year, all
 * from the offer's server-composed data and all escaped.
 */

import { text, type DocLang } from '../format'
import type { OfferCover } from '../params'
import type { OfferData } from '../../model'
import { wrapLabel } from '../../../brochure/diagram'
import { COVER_TILES, CONTACT_TILES, mosaic } from './mosaic'
import {
  body,
  C,
  caption,
  e,
  FONT_BODY,
  FONT_DISPLAY,
  headerBar,
  heading,
  insurerName,
  legalLine,
  MARGIN,
  numberBox,
  pageBox,
  pageNumber,
  PAGE_W,
  rich,
  stripe,
} from './shared'
import { TCI_TEXTS } from './tciTexts'

export interface BrochureContext {
  lang: DocLang
  cover: OfferCover
  data: OfferData
  /** The offer's date (ISO): its year is printed on the cover. */
  date: string
}

/** How many pages the brochure has (the offer letter is added after the cover). */
export const TCI_PAGE_COUNT = 9

const P = (value: string, size = 15, colour: string = C.ink) =>
  `<p style="margin: 0; font-size: ${size}px; line-height: 1.6; color: ${colour};">${rich(value)}</p>`

const triangle = (colour: string = C.orange) =>
  `<span style="flex-shrink: 0; width: 0; height: 0; margin-top: 6px; border-left: 10px solid ${colour}; border-top: 6px solid transparent; border-bottom: 6px solid transparent;"></span>`

const bullet = (value: string, size = 14.5, colour: string = C.ink) =>
  `<div style="display: flex; gap: 12px; align-items: flex-start;">${triangle()}<div style="font-size: ${size}px; line-height: 1.55; color: ${colour};">${rich(value)}</div></div>`

const cardTitle = (value: string, colour: string = C.navy, size = 22) =>
  `<div style="font-family: ${FONT_DISPLAY}; font-size: ${size}px; font-weight: 700; line-height: 1.15; color: ${colour};">${e(value)}</div>`

const CORNER = 'border-radius: 0 28px 0 0;'

function inner(ctx: BrochureContext, n: number, content: string, gap?: number): string {
  return pageBox(`${headerBar(ctx.lang, ctx.data)}${body(content, { gap })}${pageNumber(n)}${legalLine(ctx.lang, ctx.data)}`)
}

// ---------------------------------------------------------------------------
// 1. Cover
// ---------------------------------------------------------------------------

interface CoverStyle {
  bg: string
  bar: string
  chipBg: string
  chipFg: string
  kicker: string
  titleA: string
  titleB: string
  foot: string
}

/** The three covers. Text on the coloured covers is white, amber or deep navy
 * at a large size only. */
export const COVER_STYLES: Readonly<Record<OfferCover, CoverStyle>> = {
  white: {
    bg: C.white,
    bar: C.navy,
    chipBg: C.navy,
    chipFg: C.white,
    kicker: C.navy,
    titleA: C.navy,
    titleB: C.blue,
    foot: C.navy,
  },
  navy: {
    bg: C.navy,
    bar: C.navyDark,
    chipBg: C.orange,
    chipFg: C.navyDark,
    kicker: C.white,
    titleA: C.white,
    titleB: C.amber,
    foot: C.navyDark,
  },
  blue: {
    bg: C.blue,
    bar: C.navy,
    chipBg: C.navyDark,
    chipFg: C.white,
    kicker: C.navyDark,
    titleA: C.white,
    titleB: C.navyDark,
    foot: C.navy,
  },
}

function coverPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].cover
  const s = COVER_STYLES[ctx.cover]
  const insurer = insurerName(ctx.data)
  const year = /^\d{4}/.exec(ctx.date)?.[0] ?? ''
  const client = text(ctx.data.client?.name)
  const clientName = [text(ctx.data.client?.legal_form), client].filter(Boolean).join(' ')
  // A long registered name steps down in size rather than pushing the foot
  // off the page.
  const clientSize = clientName.length <= 40 ? 24 : clientName.length <= 80 ? 20 : 16
  return pageBox(
    `<div data-kp-cover="${ctx.cover}" style="background: ${s.bar}; height: 104px; box-sizing: border-box; padding: 0 ${MARGIN}px; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-shrink: 0; color: ${C.white};">
  <div style="min-width: 0; font-family: ${FONT_DISPLAY}; font-size: 22px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; overflow-wrap: anywhere;">${insurer ? e(insurer) : ''}</div>
  <div style="font-family: ${FONT_DISPLAY}; font-size: 20px; font-weight: 700; flex-shrink: 0;">${e(year)}</div>
</div>
<div style="padding: 64px ${MARGIN}px 0; display: flex; flex-direction: column; gap: 26px;">
  <div style="display: flex; align-items: center; gap: 14px;">
    <div style="background: ${s.chipBg}; color: ${s.chipFg}; font-family: ${FONT_DISPLAY}; font-size: 19px; font-weight: 700; letter-spacing: 0.18em; padding: 5px 16px;">TCI</div>
    <div style="font-family: ${FONT_DISPLAY}; font-size: 19px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${s.kicker};">${e(t.kicker)}</div>
  </div>
  <h1 style="margin: 0; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 62px; line-height: 1.04; color: ${s.titleA};">${e(t.titleA)} <span style="color: ${s.titleB};">${e(t.titleB)}</span></h1>
</div>
<div style="flex-grow: 1;"></div>
<div style="flex: 0 1 auto; min-height: 300px; overflow: hidden;">${mosaic(COVER_TILES, PAGE_W)}</div>
<div style="background: ${s.foot}; flex-shrink: 0; box-sizing: border-box; min-height: 128px; padding: 22px ${MARGIN}px 44px; display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; color: ${C.white};">
  <div style="min-width: 0; display: flex; flex-direction: column; gap: 6px;">
    ${client ? `${caption(t.preparedFor, C.tint2)}<div data-kp-client style="font-family: ${FONT_DISPLAY}; font-size: ${clientSize}px; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere;">${e(clientName)}</div>` : ''}
  </div>
  <div style="flex-shrink: 0; max-width: 280px; text-align: right; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere;">${insurer ? e(insurer) : ''}</div>
</div>
${legalLine(ctx.lang, ctx.data, C.line)}`,
    { bg: s.bg },
  )
}

// ---------------------------------------------------------------------------
// 2. What TCI is
// ---------------------------------------------------------------------------

function whatPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].what
  const chips = t.termChips
    .map(
      (c) =>
        `<span style="display: inline-block; background: ${C.tint2}; color: ${C.navy}; font-size: 12.5px; font-weight: 600; line-height: 1.3; padding: 6px 10px;">${e(c)}</span>`,
    )
    .join('')
  return inner(
    ctx,
    2,
    `${heading(t.title)}
<div style="display: flex; flex-direction: column; gap: 12px;">${t.paragraphs.map((p) => P(p)).join('')}</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 6px;">
  <div style="background: ${C.orangeTint}; ${CORNER} padding: 24px; display: flex; flex-direction: column; gap: 14px;">${cardTitle(t.benefitsTitle)}${t.benefits.map((b) => bullet(b)).join('')}</div>
  <div style="background: ${C.white}; border: 1px solid ${C.line}; ${CORNER} padding: 24px; display: flex; flex-direction: column; gap: 14px;">${cardTitle(t.termsTitle)}<div style="font-size: 14.5px; line-height: 1.55;">${rich(t.terms)}</div><div style="display: flex; flex-wrap: wrap; gap: 8px;">${chips}</div></div>
</div>
<div style="background: ${C.navy}; padding: 26px 32px; display: flex; gap: 18px; align-items: flex-start; margin-top: 6px;">
  <div style="flex-shrink: 0; font-family: ${FONT_DISPLAY}; font-size: 64px; line-height: 0.8; font-weight: 700; color: ${C.amber};">“</div>
  <div style="font-family: ${FONT_DISPLAY}; font-size: 26px; font-weight: 700; line-height: 1.25; color: ${C.white};">${e(t.quote)}</div>
</div>`,
  )
}

// ---------------------------------------------------------------------------
// 3. How it works
// ---------------------------------------------------------------------------

const DIAGRAM = {
  width: 720,
  height: 300,
  node: { w: 200, h: 64 },
  insurer: { x: 260, y: 10 },
  policyholder: { x: 30, y: 210 },
  buyer: { x: 490, y: 210 },
  chars: { side: 24, inner: 20, bottom: 30 },
} as const

function svgLabel(x: number, y: number, value: string, chars: number, anchor: 'start' | 'middle' | 'end', grow: 'centre' | 'down' | 'up', bold: boolean): string {
  const lines = wrapLabel(value, chars)
  const step = 16
  const first = grow === 'down' ? y : grow === 'up' ? y - (lines.length - 1) * step : y - ((lines.length - 1) * step) / 2
  const spans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : step}">${e(line)}</tspan>`).join('')
  return `<text x="${x}" y="${first}" text-anchor="${anchor}" dominant-baseline="middle" font-family="${FONT_BODY}" font-size="13" font-weight="${bold ? 700 : 400}" fill="${C.ink}" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${spans}</text>`
}

function svgNode(x: number, y: number, title: string, subtitle: string, filled: boolean, stroke: string): string {
  const { w, h } = DIAGRAM.node
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0" fill="${filled ? C.navy : C.white}" stroke="${filled ? C.navy : stroke}" stroke-width="2"></rect><text x="${x + w / 2}" y="${y + 27}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="19" font-weight="700" letter-spacing="0.5" fill="${filled ? C.white : C.navy}">${e(title.toUpperCase())}</text><text x="${x + w / 2}" y="${y + 48}" text-anchor="middle" font-family="${FONT_BODY}" font-size="12" fill="${filled ? C.tint2 : C.muted}">${e(subtitle)}</text></g>`
}

function diagram(lang: DocLang): string {
  const d = TCI_TEXTS[lang].how.diagram
  const { node, insurer: ins, policyholder: ph, buyer: by, chars } = DIAGRAM
  const phRight = ph.x + node.w
  const sellY = ph.y + 20
  const payY = ph.y + 46
  const insBottom = ins.y + node.h
  const markers = { navy: C.navy, blue: C.blue, orange: C.orange, muted: C.muted }
  const defs = Object.entries(markers)
    .map(
      ([name, colour]) =>
        `<marker id="kp-arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${colour}"></path></marker>`,
    )
    .join('')
  const line = (x1: number, y1: number, x2: number, y2: number, colour: keyof typeof markers, width: number, dash = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${markers[colour]}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#kp-arrow-${colour})"></line>`
  const w = PAGE_W - 2 * MARGIN
  const h = Math.round((w * DIAGRAM.height) / DIAGRAM.width)
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${DIAGRAM.width} ${DIAGRAM.height}" style="display: block; flex-shrink: 0;" role="img" aria-label="${e(TCI_TEXTS[lang].how.title)}"><defs>${defs}</defs>
${line(phRight, sellY, by.x - 2, sellY, 'navy', 2)}
${line(by.x, payY, phRight + 2, payY, 'muted', 1.5, '6 5')}
${line(175, ph.y, 298, insBottom + 2, 'orange', 2.5)}
${line(272, insBottom, 150, ph.y - 2, 'navy', 2)}
${line(446, insBottom, 568, by.y - 2, 'blue', 2)}
${svgNode(ins.x, ins.y, d.insurer, d.insurerSub, true, C.navy)}
${svgNode(ph.x, ph.y, d.policyholder, d.policyholderSub, false, C.navy)}
${svgNode(by.x, by.y, d.buyer, d.buyerSub, false, C.blue)}
${svgLabel(DIAGRAM.width / 2, sellY - 10, d.sells, chars.bottom, 'middle', 'up', true)}
${svgLabel(DIAGRAM.width / 2, payY + 18, d.pays, chars.bottom, 'middle', 'down', false)}
${svgLabel(252, 136, d.premium, chars.inner, 'start', 'centre', true)}
${svgLabel(196, 136, d.cover, chars.side, 'end', 'centre', true)}
${svgLabel(522, 136, d.monitoring, chars.side, 'start', 'centre', true)}
</svg>`
}

function howPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].how
  const steps = t.steps
    .map(
      (s, i) =>
        `<div style="background: ${C.tint}; padding: 18px 20px; display: flex; gap: 14px; align-items: flex-start;">${numberBox(i + 1, 34)}<div style="font-size: 13.5px; line-height: 1.5;">${rich(s)}</div></div>`,
    )
    .join('')
  return inner(
    ctx,
    3,
    `${heading(t.title)}
${P(t.lead)}
${diagram(ctx.lang)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">${steps}</div>`,
    20,
  )
}

// ---------------------------------------------------------------------------
// 4. What is covered
// ---------------------------------------------------------------------------

const cross = `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink: 0; margin-top: 4px;" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="${C.neg}" stroke-width="2.4" stroke-linecap="square"></path></svg>`

function coveredPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].covered
  const events = t.events
    .map(
      (ev, i) =>
        `<div style="background: ${C.tint}; ${CORNER} padding: 22px 24px; display: flex; flex-direction: column; gap: 10px;"><div style="font-family: ${FONT_DISPLAY}; font-size: 44px; font-weight: 700; line-height: 1; color: ${C.navy};">${i + 1}</div><div style="width: 40px; height: 4px; background: ${C.orange};"></div><div style="font-size: 14.5px; line-height: 1.55;">${rich(ev)}</div></div>`,
    )
    .join('')
  return inner(
    ctx,
    4,
    `${heading(t.title)}
${P(t.lead)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">${events}</div>
<div style="background: ${C.navy}; padding: 24px 28px; display: flex; flex-direction: column; gap: 12px;">${cardTitle(t.indemnityTitle, C.white)}${t.indemnity.map((s) => `<p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${C.white};">${rich(s)}</p>`).join('')}</div>
<div style="border: 1px solid ${C.line}; border-left: 5px solid ${C.orange}; padding: 22px 26px; display: flex; flex-direction: column; gap: 12px;">${cardTitle(t.notCoveredTitle, C.navy, 20)}${t.notCovered
      .map((s) => `<div style="display: flex; gap: 12px; align-items: flex-start;">${cross}<div style="font-size: 14.5px; line-height: 1.55;">${rich(s)}</div></div>`)
      .join('')}</div>
<p style="margin: 0; font-size: 13.5px; line-height: 1.55; font-style: italic; color: ${C.muted};">${rich(t.closing)}</p>`,
  )
}

// ---------------------------------------------------------------------------
// 5. Benefits
// ---------------------------------------------------------------------------

const ICONS: readonly string[] = [
  // shield
  `<path d="M20 3 L35 9 V19 C35 28 28 34 20 37 C12 34 5 28 5 19 V9 Z" fill="${C.navy}"></path><path d="M13 20 L18 25 L28 14" fill="none" stroke="${C.amber}" stroke-width="3.5"></path>`,
  // coins / financing
  `<ellipse cx="20" cy="29" rx="14" ry="6" fill="${C.navy}"></ellipse><ellipse cx="20" cy="21" rx="14" ry="6" fill="${C.blue}"></ellipse><ellipse cx="20" cy="13" rx="14" ry="6" fill="${C.orange}"></ellipse>`,
  // watching: concentric rings
  `<circle cx="20" cy="20" r="16" fill="none" stroke="${C.navy}" stroke-width="3"></circle><circle cx="20" cy="20" r="9" fill="none" stroke="${C.blue}" stroke-width="3"></circle><circle cx="20" cy="20" r="3.5" fill="${C.orange}"></circle>`,
  // growth bars
  `<rect x="5" y="24" width="8" height="12" fill="${C.blue}"></rect><rect x="16" y="16" width="8" height="20" fill="${C.navy}"></rect><rect x="27" y="7" width="8" height="29" fill="${C.orange}"></rect>`,
  // returning arrow
  `<path d="M30 12 A12 12 0 1 0 32 24" fill="none" stroke="${C.amber}" stroke-width="3.5"></path><path d="M24 5 L32 12 L24 18 Z" fill="${C.amber}"></path>`,
]

const icon = (i: number) =>
  `<svg width="40" height="40" viewBox="0 0 40 40" style="display: block; flex-shrink: 0;" aria-hidden="true">${ICONS[i] ?? ''}</svg>`

function benefitsPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].benefits
  const cards = t.items.slice(0, 4)
  const last = t.items[4]
  const grid = cards
    .map(
      (item, i) =>
        `<div style="background: ${i === 0 || i === 3 ? C.orangeTint : C.tint}; ${CORNER} padding: 24px; display: flex; flex-direction: column; gap: 12px;">${icon(i)}${cardTitle(item.title, C.navy, 21)}<div style="font-size: 14px; line-height: 1.55;">${rich(item.text)}</div></div>`,
    )
    .join('')
  return inner(
    ctx,
    5,
    `${heading(t.title)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">${grid}</div>
${
  last
    ? `<div style="background: ${C.navy}; padding: 22px 26px; display: flex; gap: 18px; align-items: center;">${icon(4)}<div style="display: flex; flex-direction: column; gap: 6px;">${cardTitle(last.title, C.white, 21)}<div style="font-size: 14.5px; line-height: 1.55; color: ${C.white};">${rich(last.text)}</div></div></div>`
    : ''
}`,
  )
}

// ---------------------------------------------------------------------------
// 6. Credit limits
// ---------------------------------------------------------------------------

function limitsPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].limits
  const [first = '', ...rest] = t.definition
  const steps = t.steps
    .map(
      (s, i) =>
        `<div style="display: flex; gap: 14px; align-items: flex-start;">${numberBox(i + 1, 30, C.orange, C.navyDark)}<div style="font-size: 14.5px; line-height: 1.55; padding-top: 4px;">${rich(s)}</div></div>`,
    )
    .join('')
  return inner(
    ctx,
    6,
    `${heading(t.title)}
<div style="background: ${C.tint2}; ${CORNER} padding: 26px 30px; display: flex; flex-direction: column; gap: 10px;"><div style="font-family: ${FONT_DISPLAY}; font-size: 25px; font-weight: 700; line-height: 1.25; color: ${C.navy};">${rich(first)}</div>${rest.map((s) => `<div style="font-size: 15px; line-height: 1.55;">${rich(s)}</div>`).join('')}</div>
<div style="display: flex; flex-direction: column; gap: 14px;">${cardTitle(t.stepsTitle)}${steps}</div>
<div style="background: ${C.navy}; padding: 24px 28px; display: flex; flex-direction: column; gap: 10px;">${cardTitle(t.dlTitle, C.white)}<div style="font-size: 15px; line-height: 1.6; color: ${C.white};">${rich(t.dl)}</div></div>`,
  )
}

// ---------------------------------------------------------------------------
// 7. From request to policy
// ---------------------------------------------------------------------------

function processPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].process
  const steps = t.steps
    .map((s, i) => {
      const offer = i === 2
      const dot = `<div style="flex-shrink: 0; width: 46px; height: 46px; border-radius: 50%; background: ${offer ? C.orange : C.navy}; color: ${offer ? C.navyDark : C.white}; display: flex; align-items: center; justify-content: center; font-family: ${FONT_DISPLAY}; font-size: 22px; font-weight: 700; position: relative; z-index: 1;">${i + 1}</div>`
      return `<div style="display: flex; gap: 20px; align-items: flex-start;">${dot}<div style="display: flex; flex-direction: column; gap: 6px; padding-top: 8px;">${cardTitle(s.title)}<div style="font-size: 14.5px; line-height: 1.55;">${rich(s.text)}</div></div></div>`
    })
    .join('')
  return inner(
    ctx,
    7,
    `${heading(t.title)}
${P(t.lead)}
<div style="position: relative; display: flex; flex-direction: column; gap: 26px; margin-top: 8px;"><div style="position: absolute; left: 22px; top: 20px; bottom: 40px; width: 2px; background: ${C.line};"></div>${steps}</div>`,
  )
}

// ---------------------------------------------------------------------------
// 8. FAQ
// ---------------------------------------------------------------------------

function faqPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].faq
  const items = t.items
    .map(
      (item, i) =>
        `<div style="background: ${i % 4 === 0 || i % 4 === 3 ? C.tint : C.white}; border: 1px solid ${i % 4 === 0 || i % 4 === 3 ? C.tint : C.line}; ${CORNER} padding: 18px 20px; display: flex; flex-direction: column; gap: 8px;"><div style="display: flex; gap: 10px; align-items: flex-start;"><span style="flex-shrink: 0; width: 22px; height: 22px; background: ${C.orange}; color: ${C.navyDark}; font-family: ${FONT_DISPLAY}; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center;">?</span>${cardTitle(item.q, C.navy, 18)}</div><div style="font-size: 13px; line-height: 1.5;">${rich(item.a)}</div></div>`,
    )
    .join('')
  return inner(
    ctx,
    8,
    `${heading(t.title)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">${items}</div>`,
  )
}

// ---------------------------------------------------------------------------
// 9. Contacts
// ---------------------------------------------------------------------------

function contactCard(label: string, values: string[], wide = false): string {
  return `<div style="background: ${C.white}; ${CORNER} padding: 18px 22px; display: flex; flex-direction: column; gap: 6px;${wide ? ' grid-column: 1 / -1;' : ''}">${caption(label)}${values
    .map(
      (v, i) =>
        `<div style="font-family: ${i === 0 ? FONT_DISPLAY : FONT_BODY}; font-size: ${i === 0 ? 21 : 14}px; font-weight: ${i === 0 ? 700 : 500}; line-height: 1.3; color: ${C.navy}; overflow-wrap: anywhere;">${e(v)}</div>`,
    )
    .join('')}</div>`
}

function contactsPage(ctx: BrochureContext): string {
  const t = TCI_TEXTS[ctx.lang].contacts
  const ins = ctx.data.insurer
  const cards: string[] = []
  const phone = text(ins?.phone)
  const email = text(ins?.email)
  const website = text(ins?.website)
  const address = text(ins?.address)
  if (phone) cards.push(contactCard(t.labels.phone, [phone]))
  if (email) cards.push(contactCard(t.labels.email, [email]))
  if (website) cards.push(contactCard(t.labels.website, [website]))
  if (address) cards.push(contactCard(t.labels.address, [address]))
  const contact = ctx.data.contact
  const manager = [text(contact?.name), text(contact?.phone), text(contact?.email)].filter((v): v is string => v !== null)
  if (manager.length) cards.push(contactCard(t.labels.manager, manager, cards.length % 2 === 0))
  const insurer = insurerName(ctx.data)
  return pageBox(
    `${mosaic(CONTACT_TILES, PAGE_W)}
<div data-kp-body style="flex: 1 1 auto; min-height: 0; overflow: hidden; box-sizing: border-box; padding: 44px ${MARGIN}px 0; margin-bottom: 120px; display: flex; flex-direction: column; gap: 20px;">
  <div style="display: flex; flex-direction: column; gap: 14px;"><div style="width: 56px; height: 5px; background: ${C.orange};"></div><h1 style="margin: 0; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 46px; line-height: 1.08; color: ${C.white};">${e(t.title)}</h1></div>
  ${t.paragraphs.map((p) => P(p, 15.5, C.white)).join('')}
  ${cards.length ? `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 6px;">${cards.join('')}</div>` : ''}
</div>
<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 112px; display: flex; flex-direction: column;">${stripe(8)}<div style="flex: 1; background: ${C.navyDark}; padding: 18px ${MARGIN}px 0; box-sizing: border-box; color: ${C.white}; font-size: 14px; font-weight: 600; overflow-wrap: anywhere;">${insurer ? e(insurer) : ''}</div></div>
${legalLine(ctx.lang, ctx.data, C.line)}`,
    { bg: C.navy },
  )
}

/** The brochure's pages in print order. */
export function tciBrochurePages(ctx: BrochureContext): string[] {
  return [
    coverPage(ctx),
    whatPage(ctx),
    howPage(ctx),
    coveredPage(ctx),
    benefitsPage(ctx),
    limitsPage(ctx),
    processPage(ctx),
    faqPage(ctx),
    contactsPage(ctx),
  ]
}
