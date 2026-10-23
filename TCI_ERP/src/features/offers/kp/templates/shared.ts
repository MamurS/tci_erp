/**
 * What every page of the offer document shares: the palette (the app's brand
 * tokens from src/index.css), the two faces (PT Sans Narrow for display, Inter
 * for text — public/kp/tci/fonts.css), the A4 page box, the navy header bar
 * with the insurer's contacts, the page number and the legal line.
 *
 * Pure string templates. Every dynamic value is escaped HERE, at the point it
 * enters the markup; the callers pass plain strings.
 *
 * Contrast. Orange and amber are fills, rules and shapes — never text on
 * white (DESIGN.md «Amber is not a text colour»). Text on the navy bar and on
 * the navy and blue covers is white or amber at a large size; body text is
 * ink or navy on white and on the light tints.
 */

import { escapeHtml, text, type DocLang } from '../format'
import type { OfferData } from '../../model'
import { TCI_BROCHURE_VERSION, TCI_TEXTS } from './tciTexts'

export const PAGE_W = 794
export const PAGE_H = 1123
export const MARGIN = 56
export const HEADER_H = 104
/** Room kept free at the foot of a page for the page number and legal line. */
export const FOOT_H = 72
/** The same on a letter page, which has no page number: the legal line only. */
export const LETTER_FOOT_H = 40

export const C = {
  navy: '#005288',
  navyDark: '#00243C',
  navy800: '#003557',
  blue: '#0093D0',
  blueLight: '#8CC8E6',
  orange: '#F7941E',
  amber: '#FCAF17',
  ink: '#191919',
  muted: '#55606B',
  tint: '#F2F8FC',
  tint2: '#DCEFF8',
  line: '#C9DDE9',
  orangeTint: '#FEF0DE',
  white: '#FFFFFF',
  legal: '#5F6B78',
  pos: '#2E8B3E',
  posTint: '#EAF5EC',
  neg: '#B21F1F',
  negTint: '#FDECEC',
  neutralTint: '#EEF1F4',
} as const

export const FONT_DISPLAY = "'PT Sans Narrow', 'Arial Narrow', Arial, sans-serif"
export const FONT_BODY = "'Inter Variable', Inter, 'Segoe UI', Arial, sans-serif"

export const e = escapeHtml

/** Escape a template text and set its **…** runs in bold. */
export function rich(value: string, weight = 700): string {
  return e(value).replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight: ${weight};">$1</strong>`)
}

/** The insurer as the document names it: legal form and name, or null. */
export function insurerName(data: Pick<OfferData, 'insurer'>): string | null {
  const ins = data.insurer
  if (!ins) return null
  return [text(ins.legal_form), text(ins.legal_name)].filter(Boolean).join(' ') || null
}

/** The A4 page box. `body` is the content; the footer pieces are absolute. */
export function pageBox(content: string, opts: { bg?: string; attrs?: string } = {}): string {
  const bg = opts.bg ?? C.white
  return `<div style="width: ${PAGE_W}px; height: ${PAGE_H}px; box-sizing: border-box; background: ${bg}; position: relative; overflow: hidden; display: flex; flex-direction: column; font-family: ${FONT_BODY}; color: ${C.ink};"${opts.attrs ? ` ${opts.attrs}` : ''}>${content}</div>`
}

/** The navy bar at the top of every inner page and of the offer letter:
 * the insurer's phone and e-mail on the left (from the offer's data), the
 * product on the right. Nothing on the left when the data has neither. */
export function headerBar(lang: DocLang, data: Pick<OfferData, 'insurer'>): string {
  const t = TCI_TEXTS[lang].header
  const phone = text(data.insurer?.phone)
  const email = text(data.insurer?.email)
  const lines: string[] = []
  if (phone) lines.push(`${e(t.call)} <strong style="font-weight: 600; white-space: nowrap;">${e(phone)}</strong>`)
  if (email) lines.push(`${e(t.write)} <strong style="font-weight: 600;">${e(email)}</strong>`)
  const name = insurerName(data)
  const left = lines.length ? lines.join('<br>') : name ? `<strong style="font-weight: 600;">${e(name)}</strong>` : ''
  return `<div data-kp-header style="background: ${C.navy}; height: ${HEADER_H}px; box-sizing: border-box; padding: 0 ${MARGIN}px; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-shrink: 0; color: ${C.white}; font-size: 14px; line-height: 1.6;">
  <div style="flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere;">${left}</div>
  <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; max-width: 300px; font-family: ${FONT_DISPLAY}; font-weight: 700; text-transform: uppercase;"><span style="flex-shrink: 0; display: inline-block; width: 10px; height: 10px; background: ${C.orange};"></span><span style="flex-shrink: 0; font-size: 20px; letter-spacing: 0.08em; color: ${C.amber};">TCI</span><span style="font-size: 15px; line-height: 1.2; letter-spacing: 0.05em;">${e(t.label)}</span></div>
</div>`
}

/** The page's content area: it takes the height between the header and the
 * foot. `data-kp-body` lets the layout test prove nothing overflows it. */
export function body(content: string, opts: { pad?: string; gap?: number; foot?: number } = {}): string {
  return `<div data-kp-body style="flex: 1 1 auto; min-height: 0; overflow: hidden; box-sizing: border-box; padding: ${opts.pad ?? `40px ${MARGIN}px 0`}; margin-bottom: ${opts.foot ?? FOOT_H}px; display: flex; flex-direction: column; gap: ${opts.gap ?? 22}px;">${content}</div>`
}

/** A printed page number, bottom centre (brochure pages only). */
export function pageNumber(n: number, colour: string = C.muted): string {
  return `<div data-kp-page-no style="position: absolute; left: 0; right: 0; bottom: 44px; text-align: center; font-family: ${FONT_DISPLAY}; font-size: 14px; font-weight: 700; color: ${colour};">${n}</div>`
}

/** The legal line at the very bottom of every page: template version,
 * insurer, the disclaimer. */
export function legalLine(lang: DocLang, data: Pick<OfferData, 'insurer'>, colour: string = C.legal): string {
  const name = insurerName(data)
  const parts = [TCI_BROCHURE_VERSION, name, TCI_TEXTS[lang].legal].filter(Boolean) as string[]
  return `<div data-legal style="position: absolute; left: ${MARGIN}px; right: ${MARGIN}px; bottom: 10px; font-size: 9px; line-height: 1.35; color: ${colour}; text-align: left;">${parts.map(e).join(' · ')}</div>`
}

/** A page heading: condensed, navy, with a short orange rule above it. */
export function heading(value: string, size = 44): string {
  return `<div style="display: flex; flex-direction: column; gap: 14px;"><div style="width: 56px; height: 5px; background: ${C.orange};"></div><h1 style="margin: 0; font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: ${size}px; line-height: 1.08; color: ${C.navy};">${e(value)}</h1></div>`
}

/** A caption above a group: small, uppercase, letter-spaced. */
export function caption(value: string, colour: string = C.muted): string {
  return `<div style="font-size: 11.5px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: ${colour};">${e(value)}</div>`
}

/** A square with a number in it (steps). */
export function numberBox(n: number, size = 36, bg: string = C.navy, fg: string = C.white): string {
  return `<div style="flex-shrink: 0; width: ${size}px; height: ${size}px; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-family: ${FONT_DISPLAY}; font-size: ${Math.round(size * 0.5)}px; font-weight: 700;">${n}</div>`
}

/** The coloured stripe of the brand palette (contacts page, cover foot). */
export function stripe(height = 8): string {
  const colours = [C.blue, C.blueLight, C.orange, C.amber]
  return `<div style="display: flex; height: ${height}px; flex-shrink: 0;">${colours.map((c) => `<div style="flex: 1; background: ${c};"></div>`).join('')}</div>`
}
