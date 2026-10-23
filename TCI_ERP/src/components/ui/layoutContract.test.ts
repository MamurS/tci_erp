/**
 * Layout rules that a type checker cannot see, checked on the source text.
 *
 * - A Card has no padding of its own (it is also the frame of flush lists and
 *   tables), so every Card states one — or `overflow-hidden`, which marks a
 *   flush container whose rows pad themselves. A bare <Card> put text on the
 *   border on ~50 screens before the October 2026 audit.
 * - A Table draws its own frame; wrapped in a padding-less Card it draws two.
 * - Dates reach the screen through format.ts, never as a sliced ISO string.
 * - Interaction rules from the October 2026 owner review (each was found on a
 *   real screen): one action is offered once per view (never in a header AND
 *   in the empty state below it); a company or any long list is picked with
 *   the typeahead (Combobox / EntityPicker), never a listbox <select size>;
 *   confirmation is ConfirmDialog, never window.confirm; a link that looks
 *   like a button is a LinkButton, never <a> wrapping <button>; a section
 *   header is ONE SectionTitle with `hint` / `actions`, never a hand-made
 *   flex row around it (they drifted to five different spacings).
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('../../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const files = Object.entries(SOURCES).filter(([path]) => !path.endsWith('.test.tsx'))

describe('layout contract', () => {
  it('scans the application', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every Card states its padding (or is a flush overflow-hidden frame)', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (path.endsWith('/primitives.tsx') || path.endsWith('/detail.tsx')) continue
      for (const m of text.matchAll(/<Card\b([^>]*)>/g)) {
        const attrs = m[1] ?? ''
        const padded = /\bp[xy]?-\d|\bp-0\b|overflow-hidden/.test(attrs)
        if (!padded) offenders.push(`${path}: <Card${attrs}>`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no Table is wrapped directly in a Card', () => {
    const offenders = files
      .filter(([, text]) => /<Card[^>]*>\s*<Table\b/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('no ISO date is sliced for display', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      for (const line of text.split('\n')) {
        // `.slice(0, 10)` / `.slice(0, 16)` on a timestamp, inside JSX or a
        // template — computing "today" for an <input type="date"> is fine.
        if (/(_at|_date|date|Date)\)?\.slice\(0, 1[06]\)/.test(line) && !/useState|today|toISOString/.test(line))
          offenders.push(`${path}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /** The `action={...}` expression of each <EmptyState …> opening tag, brace-matched. */
  function emptyStateActions(text: string): string[] {
    const out: string[] = []
    for (const m of text.matchAll(/<EmptyState\b/g)) {
      let i = m.index + m[0].length
      let depth = 0
      let tagEnd = -1
      for (; i < text.length; i++) {
        const c = text[i]
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) {
          tagEnd = i
          break
        }
      }
      const tag = text.slice(m.index, tagEnd)
      const at = tag.indexOf('action={')
      if (at < 0) continue
      let d = 0
      let j = at + 'action='.length
      const from = j
      for (; j < tag.length; j++) {
        if (tag[j] === '{') d++
        else if (tag[j] === '}' && --d === 0) break
      }
      out.push(tag.slice(from, j + 1))
    }
    return out
  }

  // An empty state that REPLACES the view its sibling action lives in (the
  // toolbar is not rendered while it shows) is not a duplicate.
  const ONE_ACTION_ALLOWED: Record<string, string> = {
    'FinancialsTab.tsx': 'the empty state is returned instead of the toolbar',
    'PolicyLimitsSection.tsx': 'the header button renders only once there are rows',
  }

  it('offers an action once: an empty state never repeats an action shown elsewhere in the file', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (Object.keys(ONE_ACTION_ALLOWED).some((name) => path.endsWith(`/${name}`))) continue
      for (const action of emptyStateActions(text)) {
        for (const k of action.matchAll(/t\('([^']+)'/g)) {
          const key = k[1]!
          if (key.startsWith('common.')) continue
          const uses = text.split(`t('${key}'`).length - 1
          if (uses > 1) offenders.push(`${path}: ${key} (×${uses})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never uses a listbox <select size>, window.confirm / alert, or <Link> around <Button>', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (/<Select\b[^>]*\bsize=\{|<select\b[^>]*\bsize=/.test(text)) offenders.push(`${path}: listbox select`)
      if (/window\.confirm\(|window\.alert\(|[^.\w]alert\(/.test(text)) offenders.push(`${path}: native dialog`)
      if (/<Link\b[^>]*>\s*<Button\b/.test(text)) offenders.push(`${path}: <Link> around <Button>`)
    }
    expect(offenders).toEqual([])
  })

  it('builds a section header from SectionTitle props, not a hand-made row around it', () => {
    const offenders = files
      .filter(([path]) => !path.endsWith('/primitives.tsx'))
      .filter(([, text]) => /justify-between[^>]*>\s*(<div>\s*)?<SectionTitle\b/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  // «No layout shift on interaction» (DESIGN.md): a table is laid out fixed
  // from declared widths, so nothing in it moves when a status, a button or a
  // translation changes. The browser half of this rule is e2e/layout.
  const FIXED_TABLE_PENDING: Record<string, string> = {
    'PolicyPremiumTab.tsx': 'premium screens being rebuilt in the same round (Prompt 23); remove when they land',
    'PortalPremiumPage.tsx': 'premium screens being rebuilt in the same round (Prompt 23); remove when they land',
  }

  it('every Table (and TableCard) declares its column widths', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (path.endsWith('/primitives.tsx')) continue
      if (Object.keys(FIXED_TABLE_PENDING).some((name) => path.endsWith(`/${name}`))) continue
      for (const m of text.matchAll(/<(Table|TableCard)\b([^>]*)>/g)) {
        if (!/\bcolumns=/.test(m[2] ?? '')) offenders.push(`${path}: <${m[1]}${(m[2] ?? '').slice(0, 40)}>`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never reveals on hover by display (hidden → flex): the space must stay taken', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      for (const line of text.split('\n')) {
        if (/\bhidden\b[^"'`]*\bgroup-(hover|focus-within)(\/\w+)?:(flex|block|inline-flex|inline|grid)\b|group-(hover|focus-within)(\/\w+)?:hidden\b/.test(line))
          offenders.push(`${path}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('a right-aligned table header is a numeric one (`num`), as its cells are', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (Object.keys(FIXED_TABLE_PENDING).some((name) => path.endsWith(`/${name}`))) continue
      if (!/<Table\b/.test(text)) continue
      for (const m of text.matchAll(/<th className="([^"]*)"/g))
        if (/\btext-right\b/.test(m[1] ?? '') && !/\bnum\b/.test(m[1] ?? '')) offenders.push(`${path}: <th className="${m[1]}">`)
    }
    expect(offenders).toEqual([])
  })

  it('takes dates in DateInput, never the browser date field', () => {
    // <input type="date"> follows the BROWSER's locale: «mm/dd/yyyy» in a
    // Russian interface, where «04/03/2026» reads as 4 March.
    const offenders = files
      .filter(([path]) => !path.endsWith('/DateInput.tsx'))
      .filter(([, text]) => /type=["']date["']/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('puts cards side by side only in a PanelGrid (equal height), or says why not', () => {
    // A responsive grid with `items-start` is the ad-hoc card row the owner
    // rejected: its cards end at different heights. Rows of cards are a
    // PanelGrid (DESIGN.md «Side-by-side cards»); what is left here is not a
    // row of cards, and says so.
    const NOT_A_CARD_ROW: Record<string, string> = {
      'LimitRequestPage.tsx': 'a column of stacked sections (request, decision form, …) beside the buyer snapshot',
      'DraftPage.tsx': 'the contract document beside a stacked, sticky contents / comments column',
      'PortalContractsPage.tsx': 'the contract document beside a stacked comments column',
      'PortalPoliciesPage.tsx': 'a list of policies beside the next-steps aside',
      'PortalSubmissionsPage.tsx': 'two text sections inside one card, not cards',
      // Excluded from the October 2026 card pass: rebuilt separately.
      'OfferEditPage.tsx': 'excluded — rebuilt separately',
      'BrochureView.tsx': 'excluded — rebuilt separately',
      'BrochureBody.tsx': 'excluded — rebuilt separately',
    }
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (Object.keys(NOT_A_CARD_ROW).some((name) => path.endsWith(`/${name}`))) continue
      for (const line of text.split('\n'))
        if (/["'`][^"'`]*\bgrid\b[^"'`]*\bitems-start\b[^"'`]*\b(sm|md|lg|xl|2xl):grid-cols-/.test(line))
          offenders.push(`${path}: ${line.trim()}`)
    }
    expect(offenders).toEqual([])
  })
})
