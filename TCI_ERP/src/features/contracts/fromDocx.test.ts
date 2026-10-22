import { describe, expect, it } from 'vitest'

import { buildWordingContext } from '../wording/context'
import type { MergeData } from '../wording/context'
import { templateToDoc } from './fromDocx'
import { generateFromTemplate } from './generate'
import { collectFields } from './mergeFields'
import type { ContractDoc, HeadingNode, ParagraphNode, TableNode } from './model'
import { blockText, inlineText } from './model'
import { docNumbering } from './numbering'

import EN from '../wording/defaults/policy-wording-en.docx?inline'
import RU from '../wording/defaults/policy-wording-ru.docx?inline'
import UZ from '../wording/defaults/policy-wording-uz.docx?inline'

const DEFAULTS: Record<string, string> = { en: EN, ru: RU, uz: UZ }
const bytes = (lang: string): ArrayBuffer =>
  Uint8Array.from(atob(DEFAULTS[lang]!.split(',')[1]!), (c) => c.charCodeAt(0)).buffer

const DATA: MergeData = {
  source: { kind: 'policy', id: 'p1' },
  insurer: { name: 'Insurer JSC', license_number: 'L-7', license_date: '2024-03-01' },
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
    { buyer_name: 'Beta LLC', buyer_country: 'KZ', buyer_registration_number: 'B-2', amount: 15000, currency: 'USD',
      payment_terms_days: 30, valid_from: '2026-02-01', valid_until: null },
  ],
}

const labels = { enumLabel: (_k: string, v: string) => `<${v}>`, countryName: (c: string) => c }
const context = (lang: string) => buildWordingContext(DATA, lang, labels, new Date('2026-10-22T09:00:00Z'))

describe('the standard templates become editor documents', () => {
  it.each(['ru', 'en', 'uz'])('%s: title, numbered sections and clauses, fields, two tables, a page break', (lang) => {
    const { doc, warnings } = generateFromTemplate(bytes(lang), context(lang))
    expect(warnings).toEqual([])
    const title = doc.content[0] as HeadingNode
    expect(title.type).toBe('heading')
    expect(title.attrs.level).toBe(1)
    expect(title.attrs.textAlign).toBe('center')

    const sections = doc.content.filter((b) => b.type === 'heading' && b.attrs.numbered)
    expect(sections).toHaveLength(6)
    // the typed numbers are gone from the text and derived instead
    for (const s of sections) expect(inlineText((s as HeadingNode).content)).not.toMatch(/^\d/)
    const clauses = doc.content.filter((b) => b.type === 'paragraph' && b.attrs?.clause) as ParagraphNode[]
    for (const c of clauses) expect(inlineText(c.content)).not.toMatch(/^\d+\.\d+/)

    expect(doc.content.filter((b) => b.type === 'table')).toHaveLength(2)
    expect(doc.content.some((b) => b.type === 'pageBreak')).toBe(true)
    expect(doc.attrs?.layout?.font).toBe('Arial')
    expect(doc.attrs?.layout?.sizeHalfPt).toBe(21)
    expect(doc.attrs?.layout?.page).toEqual({ w: 11906, h: 16838, top: 1134, right: 850, bottom: 1134, left: 1418 })
  })

  it('a hidden conditional clause disappears and the numbering closes the gap', () => {
    const { doc } = generateFromTemplate(bytes('ru'), context('ru'))
    const labelsByText = new Map(
      doc.content.map((b, i) => [blockText(b), docNumbering(doc)[i]] as const),
    )
    // deductible is null: clause 2.5 is gone, so the aggregate first loss
    // (2.6 in the template) is now 2.5
    const afl = [...labelsByText.entries()].find(([text]) => text.startsWith('Агрегатная франшиза'))
    expect(afl?.[1]).toBe('2.5.')
    expect([...labelsByText.keys()].some((t) => t.startsWith('Франшиза по каждому убытку'))).toBe(false)
  })

  it('every placeholder is a chip with its catalogue path and printed value', () => {
    const { doc } = generateFromTemplate(bytes('ru'), context('ru'))
    const fields = collectFields(doc)
    expect(fields.find((f) => f.path === 'policy.number')?.value).toBe('TCI-2026-001')
    expect(fields.find((f) => f.path === 'policy.insured_percentage')?.value).toBe('90%')
    // the limits row is repeated per buyer, its fields indexed
    const buyers = fields.filter((f) => f.path === 'limits.buyer_name')
    expect(buyers.map((f) => [f.index, f.value])).toEqual([
      [0, 'Alpha GmbH'],
      [1, 'Beta LLC'],
    ])
    expect(fields.every((f) => !f.path.includes('{'))).toBe(true)
  })

  it('the limits schedule has a header row and one row per buyer; the signature table has no borders', () => {
    const { doc } = generateFromTemplate(bytes('en'), context('en'))
    const [signatures, limits] = doc.content.filter((b) => b.type === 'table') as TableNode[]
    expect(signatures!.attrs?.bordered).toBe(false)
    expect(limits!.attrs?.bordered).toBe(true)
    expect(limits!.content).toHaveLength(3)
    expect(limits!.content[0]!.content.every((c) => c.type === 'tableHeader')).toBe(true)
    expect(limits!.content[1]!.content.every((c) => c.type === 'tableCell')).toBe(true)
  })
})

const doc = (body: string, extra = '') =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}${extra}</w:body></w:document>`
const p = (text: string, rPr = '', pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

describe('template sections', () => {
  it('reads a tag split across runs, with the first run’s marks', () => {
    const xml = doc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>No {{policy.</w:t></w:r><w:r><w:t>number}} &amp; more</w:t></w:r></w:p>')
    const { doc: d } = templateToDoc({ document: xml }, { policy: { number: 'P-1' } })
    const para = d.content[0] as ParagraphNode
    expect(para.content).toEqual([
      { type: 'text', text: 'No ', marks: [{ type: 'bold' }] },
      { type: 'mergeField', attrs: { path: 'policy.number', index: null, value: 'P-1' }, marks: [{ type: 'bold' }] },
      { type: 'text', text: ' & more' },
    ])
  })

  it('repeats paragraphs between a section opened and closed in different paragraphs', () => {
    const xml = doc(p('{{#limits}}') + p('Buyer {{buyer_name}}') + p('{{/limits}}') + p('End'))
    const { doc: d } = templateToDoc({ document: xml }, { limits: [{ buyer_name: 'A' }, { buyer_name: 'B' }] })
    expect(d.content.map(blockText)).toEqual(['Buyer A', 'Buyer B', 'End'])
    expect(collectFields(d).map((f) => [f.path, f.index])).toEqual([
      ['limits.buyer_name', 0],
      ['limits.buyer_name', 1],
    ])
  })

  it('an inverted section shows only when the value is empty; an empty list hides its rows', () => {
    const xml = doc(p('{{^policy.deductible}}No deductible.{{/policy.deductible}}') + p('{{#limits}}x{{/limits}}') + p('Tail'))
    const { doc: d } = templateToDoc({ document: xml }, { policy: { deductible: '' }, limits: [] })
    expect(d.content.map(blockText)).toEqual(['No deductible.', 'Tail'])
  })

  it('reports an unclosed section and keeps going', () => {
    const { warnings, doc: d } = templateToDoc({ document: doc(p('{{#policy.x}}Open') + p('Next')) }, { policy: {} })
    expect(warnings).toContain('unclosedSection')
    expect(d.content.map(blockText)).toEqual(['Open', 'Next'])
  })

  it('maps heading styles, alignment, lists and page breaks', () => {
    const numbering = `<w:numbering xmlns:w="x"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    const xml = doc(
      p('Contract', '', '<w:pStyle w:val="Title"/>') +
        p('Scope', '', '<w:pStyle w:val="Heading2"/>') +
        p('one', '', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>') +
        p('two', '', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>') +
        '<w:p><w:r><w:t>before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>' +
        p('Right', '', '<w:jc w:val="right"/>'),
    )
    const { doc: d } = templateToDoc({ document: xml, numbering }, {})
    expect(d.content.map((b) => b.type)).toEqual(['heading', 'heading', 'bulletList', 'paragraph', 'pageBreak', 'paragraph', 'paragraph'])
    expect((d.content[0] as HeadingNode).attrs.level).toBe(1)
    expect((d.content[1] as HeadingNode).attrs).toMatchObject({ level: 2, numbered: false })
    expect((d.content[6] as ParagraphNode).attrs?.textAlign).toBe('right')
  })

  it('turns vertical merges into row spans and warns about images', () => {
    const cell = (text: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${p(text)}</w:tc>`
    const xml = doc(
      `<w:tbl><w:tblPr/><w:tr>${cell('A', '<w:vMerge w:val="restart"/>')}${cell('B')}</w:tr><w:tr>${cell('', '<w:vMerge/>')}${cell('C')}</w:tr></w:tbl>` +
        '<w:p><w:r><w:drawing/></w:r></w:p>',
    )
    const { doc: d, warnings } = templateToDoc({ document: xml }, {})
    const table = d.content[0] as TableNode
    expect(table.content[0]!.content[0]!.attrs?.rowspan).toBe(2)
    expect(table.content[1]!.content).toHaveLength(1)
    expect(warnings).toContain('images')
  })
})

describe('a generated document is valid for the database', () => {
  it('is a doc with array content, well under 2 MB', () => {
    const { doc: d } = generateFromTemplate(bytes('uz'), context('uz'))
    const json: ContractDoc = JSON.parse(JSON.stringify(d))
    expect(json.type).toBe('doc')
    expect(Array.isArray(json.content)).toBe(true)
    expect(JSON.stringify(json).length).toBeLessThan(2_000_000)
    // no empty text nodes (ProseMirror refuses them)
    expect(JSON.stringify(json)).not.toContain('"text":""')
  })
})
