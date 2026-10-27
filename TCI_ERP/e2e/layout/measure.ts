/**
 * The layout guard's eyes: boxes of what must never move, read in the page.
 *
 * For every table in <main>: the table, each header cell and each cell of the
 * first row; for every list row marked `data-layout-row` (the Agenda): the row
 * and its parts; every tab and every toolbar chip. Boxes are in document
 * coordinates (a table's own horizontal scroll is added back), so scrolling
 * is not movement; dialogs and menus are left out — they float above.
 * Sticky elements (the company card's section tabs, a sheet's head) are read
 * where the flow puts them: their offset depends on how far the page has
 * scrolled, and a hover that scrolls a row into view moves nothing.
 */

import type { Page } from '@playwright/test'

export type Box = [x: number, y: number, w: number, h: number]
export type Snapshot = Record<string, Box>

/** Marks the first-row controls with data-lg-act="<n>" and returns their labels. */
export interface RowControl {
  id: string
  label: string
  /** A disclosure (aria-expanded, no popup): it opens content BELOW its row. */
  disclosure: boolean
  /** The bottom of its row, in document coordinates. */
  rowBottom: number
}

export async function markActions(page: Page): Promise<RowControl[]> {
  return page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    const outside = (el: Element) => !el.closest('[role="dialog"], [role="menu"]')
    const rows: Element[] = []
    for (const table of main.querySelectorAll('table')) {
      if (!outside(table) || !table.getClientRects().length) continue
      const tr = table.querySelector(':scope > tbody > tr')
      if (tr) rows.push(tr)
    }
    // The first row of every list marked `data-layout-row`.
    const lists = new Set<Element>()
    for (const row of main.querySelectorAll('[data-layout-row]')) {
      const list = row.closest('ul, ol') ?? row.parentElement
      if (!list || lists.has(list) || !outside(row)) continue
      lists.add(list)
      rows.push(row)
    }
    document.querySelectorAll('[data-lg-row]').forEach((el) => el.removeAttribute('data-lg-row'))
    rows.forEach((row, i) => row.setAttribute('data-lg-row', String(i)))
    const out: { id: string; label: string; disclosure: boolean; rowBottom: number }[] = []
    let n = 0
    const selector =
      'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), summary, select:not([disabled]), input[type="checkbox"]:not([disabled])'
    for (const row of rows) {
      const controls = [...(row.matches(selector) ? [row as HTMLElement] : []), ...row.querySelectorAll<HTMLElement>(selector)]
      for (const el of controls) {
        if (!el.getClientRects().length) continue
        const id = String(n++)
        el.setAttribute('data-lg-act', id)
        const label = (el.getAttribute('aria-label') ?? el.innerText ?? el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
        out.push({
          id,
          label: label || el.tagName.toLowerCase(),
          disclosure: el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup'),
          rowBottom: row.getBoundingClientRect().bottom + window.scrollY,
        })
      }
    }
    return out
  })
}

export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const out: Record<string, [number, number, number, number]> = {}
    const main = document.querySelector('main') ?? document.body
    const outside = (el: Element) => !el.closest('[role="dialog"], [role="menu"]')
    const round = (v: number) => Math.round(v * 10) / 10
    const box = (el: Element, dx = 0): [number, number, number, number] => {
      const b = el.getBoundingClientRect()
      return [round(b.left + window.scrollX + dx), round(b.top + window.scrollY), round(b.width), round(b.height)]
    }
    const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)
    // Unstick for the read: a sticky element keeps its place in the flow, so
    // static measures the layout without the scroll-dependent offset.
    const unstuck: [HTMLElement, string][] = []
    for (const el of main.querySelectorAll<HTMLElement>('*')) {
      if (getComputedStyle(el).position === 'sticky') {
        unstuck.push([el, el.style.position])
        el.style.position = 'static'
      }
    }
    let ti = 0
    for (const table of main.querySelectorAll('table')) {
      if (!outside(table) || !table.getClientRects().length) continue
      ti++
      // A table scrolled sideways inside its card has not moved.
      const scroller = table.parentElement
      const dx = scroller ? scroller.scrollLeft : 0
      const name = `table ${ti}`
      out[name] = box(table, dx)
      table.querySelectorAll(':scope > thead > tr > th').forEach((th, i) => {
        out[`${name} › header ${i + 1} «${text(th)}»`] = box(th, dx)
      })
      const tr = table.querySelector(':scope > tbody > tr')
      if (tr) {
        out[`${name} › row 1`] = box(tr, dx)
        Array.from(tr.children).forEach((td, i) => {
          out[`${name} › row 1 › cell ${i + 1}`] = box(td, dx)
        })
      }
    }
    const lists = new Set<Element>()
    for (const row of main.querySelectorAll('[data-layout-row]')) {
      const list = row.closest('ul, ol') ?? row.parentElement
      if (!list || lists.has(list) || !outside(row)) continue
      lists.add(list)
      const name = `list ${lists.size} › row 1`
      out[name] = box(row)
      Array.from(row.children).forEach((part, i) => {
        out[`${name} › part ${i + 1}`] = box(part)
      })
    }
    main.querySelectorAll('[role="tablist"]').forEach((list, li) => {
      if (!outside(list)) return
      list.querySelectorAll('[role="tab"]').forEach((tab, i) => {
        out[`tabs ${li + 1} › «${text(tab)}» (${i + 1})`] = box(tab)
      })
    })
    main.querySelectorAll('[role="toolbar"] > button').forEach((chip, i) => {
      if (outside(chip)) out[`chip ${i + 1}`] = box(chip)
    })
    for (const [el, position] of unstuck) el.style.position = position
    return out
  })
}

/**
 * Every key whose box moved or resized by more than `tolerance` px.
 * `below`: a disclosure was opened in a row ending there — what lies below it
 * may move down, and the tables holding it may grow; nothing else may move.
 */
export function moved(before: Snapshot, after: Snapshot, tolerance = 1, below?: number): string[] {
  const out: string[] = []
  for (const [key, a] of Object.entries(before)) {
    const b = after[key]
    if (!b) continue
    const names = ['x', 'y', 'w', 'h'] as const
    const opened = (n: string) =>
      below !== undefined && ((n === 'y' && a[1] >= below - 1) || (n === 'h' && /^(table \d+|list \d+ › row 1)$/.test(key)))
    const deltas = a
      .map((v, i) => [names[i], round1(b[i]! - v)] as const)
      .filter(([n, d]) => Math.abs(d) > tolerance && !opened(n))
      .map(([n, d]) => `${n} ${d > 0 ? '+' : ''}${d}`)
    if (deltas.length) out.push(`${key}: ${deltas.join(', ')}`)
  }
  return out
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Content cut where nothing may be cut, in a fixed table: a header word, a
 * status badge, a number, a date, a code or an action button outside the
 * fill column(s). Names in <Truncate> are meant to cut (full text on hover).
 * A cut badge means its column reserves too little for one of the languages.
 */
export async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>()
    const main = document.querySelector('main') ?? document.body
    const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    let ti = 0
    for (const table of main.querySelectorAll('table')) {
      if (table.closest('[role="dialog"]') || !table.getClientRects().length) continue
      ti++
      if (getComputedStyle(table).tableLayout !== 'fixed') continue
      // A list fits a laptop (DESIGN.md): its card never scrolls sideways.
      const card = table.parentElement
      if (card && card.scrollWidth > card.clientWidth + 1)
        out.add(`table ${ti} scrolls sideways: needs ${card.scrollWidth}px, has ${card.clientWidth}px`)
      const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'))
      const fill = new Set(cols.map((c, i) => ((c as HTMLElement).style.width ? -1 : i)).filter((i) => i >= 0))
      const headers = Array.from(table.querySelectorAll(':scope > thead > tr > th'))
      const headerText = (i: number) => (headers[i] ? `«${text(headers[i]!)}»` : `column ${i + 1}`)
      const over = (el: Element) => el.scrollWidth > el.clientWidth + 1
      headers.forEach((th, i) => {
        if (!fill.has(i) && over(th)) out.add(`table ${ti} › header ${i + 1} ${headerText(i)} is cut`)
      })
      for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
        Array.from(tr.children).forEach((td, i) => {
          if ((td as HTMLTableCellElement).colSpan > 1 || fill.has(i)) return
          // A name in <Truncate> (it carries its full text as a title) is
          // meant to cut; a status badge, a number, a date or a code is not.
          const inner = [td, ...Array.from(td.querySelectorAll('.truncate'))]
          const cut = inner.find((el) => over(el) && !(el.classList.contains('truncate') && el.hasAttribute('title')))
          // The action cell does not clip: its buttons must fit its width.
          const actions = td.firstElementChild
          const spill = actions && getComputedStyle(td).overflow === 'visible' && over(actions)
          if (cut || spill) out.add(`table ${ti} › ${headerText(i)}: «${text(cut ?? td)}» is cut`)
        })
      }
    }
    // A tab strip fits too: a count pill that tips it over shows a scrollbar.
    main.querySelectorAll('[role="tablist"]').forEach((list, li) => {
      if (!list.closest('[role="dialog"]') && list.scrollWidth > list.clientWidth + 1)
        out.add(`tabs ${li + 1} scroll sideways: need ${list.scrollWidth}px, have ${list.clientWidth}px`)
    })
    return [...out]
  })
}
