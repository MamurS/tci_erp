import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { exportDocx } from './exportDocx'
import { generateFromTemplate } from './generate'

import RU from '../wording/defaults/policy-wording-ru.docx?inline'

const bytes = Uint8Array.from(atob(RU.split(',')[1]!), (c) => c.charCodeAt(0)).buffer

describe('export to .docx', () => {
  it('writes the derived numbers, the field values, the tables, the page break and the page layout', async () => {
    const { doc } = generateFromTemplate(bytes, {
      policy: { number: 'TCI-9', deductible: '' },
      insurer: { name: 'Insurer JSC' },
      limits: [{ buyer_name: 'Alpha GmbH' }],
    })
    const blob = await exportDocx(doc, { title: 'TCI-9', language: 'ru-RU' })
    const zip = new PizZip(await blob.arrayBuffer())
    const xml = zip.file('word/document.xml')!.asText()
    expect(xml).toContain('TCI-9')
    expect(xml).toContain('Alpha GmbH')
    expect(xml).toContain('>1. </w:t>')
    expect(xml).toContain('>2.5. </w:t>')
    expect(xml).not.toContain('{{')
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2)
    expect(xml).toContain('w:type="page"')
    expect(xml).toMatch(/<w:pgMar[^>]*w:left="1418"/)
    expect(zip.file('word/styles.xml')!.asText()).toContain('Arial')
  })
})
