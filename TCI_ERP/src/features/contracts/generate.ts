/** A wording template's bytes → the editor document, in the browser. The
 * merge data comes from tci.wording_merge_data (the database), the printable
 * context from wording/context.ts in the TEMPLATE's language. */

import PizZip from 'pizzip'

import type { Conversion, TemplateParts } from './fromDocx'
import { templateToDoc } from './fromDocx'

export function templateParts(buffer: ArrayBuffer): TemplateParts {
  const zip = new PizZip(buffer)
  const read = (name: string) => zip.file(name)?.asText() ?? null
  const document = read('word/document.xml')
  if (!document) throw new Error('word/document.xml missing')
  return { document, styles: read('word/styles.xml'), numbering: read('word/numbering.xml') }
}

export function generateFromTemplate(buffer: ArrayBuffer, context: Record<string, unknown>): Conversion {
  return templateToDoc(templateParts(buffer), context)
}
