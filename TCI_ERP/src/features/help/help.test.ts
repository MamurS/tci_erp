/** The Help centre's pure logic: search (ru / uz normalisation, ranking),
 * which topics a page and a role get, the contents order. */
import { describe, expect, it } from 'vitest'

import en from './content/en.json'
import ru from './content/ru.json'
import uz from './content/uz.json'
import { orderSections, quickStartRoles } from './contents'
import { helpHref, helpHrefFor, helpPatternFor, helpTopicsFor, helpVisibleTo } from './pages'
import { foldHelp, matchRanges, queryWords, searchHelp } from './search'
import type { HelpBundle, HelpPageMap } from './types'

const bundle: HelpBundle = {
  lang: 'ru',
  version: '1',
  sections: [{ id: 's', folder: '01', title: 'Раздел', roles: ['all'], topics: ['a', 'b', 'c'] }],
  topics: {
    s: { id: 's', section: 's', title: 'Раздел', roles: ['all'], pages: [], order: 0, index: true, html: '', headings: [], text: 'Введение' },
    a: { id: 'a', section: 's', title: 'Решение по лимиту', roles: ['credit_underwriter'], pages: [], order: 1, html: '', headings: [], text: 'Укажите сумму лимита и нажмите «Зафиксировать решение».' },
    b: { id: 'b', section: 's', title: 'Отозвать заявку', roles: ['sales'], pages: [], order: 2, html: '', headings: [], text: 'Причина обязательна; лимит не нужен. Ещё раз: ёлка.' },
    c: { id: 'c', section: 's', title: 'Limitni so‘rash', roles: ['client'], pages: [], order: 3, html: '', headings: [], text: 'So‘rovni yuboring, bayerni tanlang.' },
  },
  terms: {},
}

describe('help search', () => {
  it('needs every word, ranks title hits first and marks the matches', () => {
    expect(searchHelp(bundle, 'лимит').map((h) => h.id)).toEqual(['a', 'b'])
    const hit = searchHelp(bundle, 'решение сумму')[0]
    expect(hit.id).toBe('a')
    expect(hit.marks.map(([x, y]) => hit.snippet.slice(x, y))).toEqual(['сумму', 'решение'])
    expect(searchHelp(bundle, 'лимит ёлка').map((h) => h.id)).toEqual(['b'])
  })
  it('treats ё as е and ignores case', () => {
    expect(searchHelp(bundle, 'ЕЛКА').map((h) => h.id)).toEqual(['b'])
    expect(queryWords('Ёлка, a')).toEqual(['елка'])
  })
  it('reads every Uzbek apostrophe alike, or none', () => {
    for (const q of ['so‘rov', "so'rov", 'soʻrov', 'so’rov', 'sorov']) expect(searchHelp(bundle, q).map((h) => h.id), q).toEqual(['c'])
    expect(foldHelp('Sug‘urta')).toBe(foldHelp("sug'urta"))
  })
  it('maps marks back onto the original text, apostrophes included', () => {
    const text = 'Limitni so‘rash'
    const [[a, b]] = matchRanges(text, queryWords('sorash'))
    expect(text.slice(a, b)).toBe('so‘rash')
  })
  it('lets the role filter what it may read', () => {
    expect(searchHelp(bundle, 'yuboring', (roles) => helpVisibleTo(roles, 'client')).map((h) => h.id)).toEqual(['c'])
    expect(searchHelp(bundle, 'лимит', (roles) => helpVisibleTo(roles, 'client'))).toEqual([])
  })
  it('finds real topics in Russian and Uzbek', () => {
    expect(searchHelp(ru as HelpBundle, 'невозмещаемые убытки').length).toBeGreaterThan(0)
    expect(searchHelp(uz as HelpBundle, "so'rov").length).toBeGreaterThan(0)
    expect(searchHelp(en as HelpBundle, 'committee')[0]).toBeTruthy()
  })
})

const pages: HelpPageMap = {
  '/limits/:id': [
    { id: 'all-limits', roles: ['all'] },
    { id: 'credit-decide', roles: ['credit_underwriter'] },
    { id: 'sales-x', roles: ['sales'] },
  ],
  '/policies/new': [{ id: 'policy-new', roles: ['commercial_underwriter'] }],
  '/policies/:id': [{ id: 'policy', roles: ['commercial_underwriter'] }],
  '/portal/limits': [{ id: 'portal-limits', roles: ['client'] }],
}

describe('help for a page', () => {
  it('prefers fixed segments: /policies/new is not /policies/:id', () => {
    expect(helpPatternFor('/policies/new', pages)).toBe('/policies/new')
    expect(helpPatternFor('/policies/abc', pages)).toBe('/policies/:id')
    expect(helpPatternFor('/nowhere', pages)).toBeNull()
  })
  it('the acting role first, then everyone, then the rest', () => {
    expect(helpTopicsFor('/limits/1', 'credit_underwriter', pages)).toEqual(['credit-decide', 'all-limits', 'sales-x'])
    expect(helpTopicsFor('/limits/1', 'sales', pages)).toEqual(['sales-x', 'all-limits', 'credit-decide'])
  })
  it('a client reads only client topics, in the portal Help centre', () => {
    expect(helpTopicsFor('/limits/1', 'client', pages)).toEqual([])
    expect(helpHrefFor('/portal/limits', 'client', pages)).toBe('/portal/help/portal-limits?from=%2Fportal%2Flimits')
    expect(helpHrefFor('/nowhere', 'client', pages)).toBe('/portal/help')
    expect(helpHrefFor('/limits/1', 'credit_underwriter', pages)).toBe('/help/credit-decide?from=%2Flimits%2F1')
  })
  it('a link inside the guide stays in the reader’s Help centre', () => {
    expect(helpHref('/help/credit-decide#x', '/portal/help')).toBe('/portal/help/credit-decide#x')
    expect(helpHref('/help/credit-decide', '/help')).toBe('/help/credit-decide')
    expect(helpHref('/limits', '/help')).toBe('/limits')
  })
  it('every portal route maps to client topics only, every staff page has a topic', () => {
    const real = (ru as HelpBundle).topics
    for (const t of Object.values(real))
      for (const p of t.pages) if (p.startsWith('/portal')) expect(t.roles, `${t.id} on ${p}`).toContain('client')
    expect(helpTopicsFor('/limits/abc', 'credit_underwriter')[0]).toBe('credit-decide')
    expect(helpTopicsFor('/portal', 'client')[0]).toBe('portal-policies')
  })
})

describe('contents', () => {
  it('orders the acting role’s sections first, a client sees the portal only', () => {
    const sections = (ru as HelpBundle).sections
    const credit = orderSections(sections, 'credit_underwriter')
    expect(credit.mine.map((s) => s.id)).toEqual(['credit'])
    expect(credit.shared.map((s) => s.id)).toEqual(['getting-started', 'glossary', 'faq'])
    expect(credit.other.map((s) => s.id)).toContain('portal')
    const client = orderSections(sections, 'client')
    expect(client.mine.map((s) => s.id)).toEqual(['portal'])
    expect([...client.shared, ...client.other]).toEqual([])
  })
  it('offers the reader’s own quick start first', () => {
    expect(quickStartRoles('claims')[0]).toBe('claims')
    expect(quickStartRoles('claims')).not.toContain('client')
    expect(quickStartRoles('client')).toEqual(['client'])
  })
})
