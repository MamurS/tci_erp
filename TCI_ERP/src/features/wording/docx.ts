/**
 * Reading and filling .docx templates in the browser (docxtemplater). The
 * syntax is `{{tag}}`, `{{#section}} … {{/section}}` for the limits loop and
 * conditional clauses. Tags are dotted paths resolved against the context
 * from context.ts; inside the limits loop the item fields come first and the
 * root context is still reachable ({{policy.currency}} works in a row).
 */

import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'

import { isKnownPlaceholder } from './catalogue'

/** A template docxtemplater cannot read (unclosed tag, broken XML, …). */
export class WordingError extends Error {
  constructor(public readonly code: 'invalid_template', detail: string) {
    super(detail)
  }
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DELIMITERS = { start: '{{', end: '}}' }

function dottedParser(tag: string) {
  const path = tag.trim()
  return {
    get(scope: unknown): unknown {
      if (path === '.') return scope
      let value: unknown = scope
      for (const key of path.split('.')) {
        if (value === null || typeof value !== 'object') return undefined
        value = (value as Record<string, unknown>)[key]
      }
      return value
    },
  }
}

interface TagReport {
  document?: { tags: Record<string, unknown> }
  headers: { tags: Record<string, unknown> }[]
  footers: { tags: Record<string, unknown> }[]
}

export interface TemplateInspection {
  /** Tags as catalogue paths: 'policy.number', 'limits', 'limits.amount'. */
  placeholders: string[]
  unknown: string[]
  /** A syntax error that makes the template unusable (unclosed tag, …). */
  error: string | null
}

/** Flatten docxtemplater's tag tree into catalogue paths. Only the limits
 *  section changes scope; any other section is a condition on the root. */
export function flattenTags(tree: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, children] of Object.entries(tree)) {
    const scoped = prefix ? `${prefix}${key}` : key
    const path = prefix && !isKnownPlaceholder(scoped) && isKnownPlaceholder(key) ? key : scoped
    out.push(path)
    if (children && typeof children === 'object' && Object.keys(children).length) {
      const childPrefix = !prefix && key === 'limits' ? 'limits.' : prefix
      out.push(...flattenTags(children as Record<string, unknown>, childPrefix))
    }
  }
  return [...new Set(out)].sort()
}

function errorText(e: unknown): string {
  const errors = (e as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors
  if (errors?.length) {
    return errors.map((x) => x.properties?.explanation ?? '').filter(Boolean).join('; ')
  }
  return e instanceof Error ? e.message : String(e)
}

export function inspectTemplate(buffer: ArrayBuffer): TemplateInspection {
  try {
    const doc = new Docxtemplater(new PizZip(buffer), {
      delimiters: DELIMITERS,
      paragraphLoop: true,
      linebreaks: true,
      parser: dottedParser,
    })
    // Docxtemplater#getTags() exists at runtime but is missing from its
    // typings; InspectModule would pull lodash into the bundle for the same.
    const parts = (doc as unknown as { getTags(): TagReport }).getTags()
    const tree: Record<string, unknown> = {}
    for (const part of [parts.document, ...parts.headers, ...parts.footers]) {
      if (part) Object.assign(tree, part.tags)
    }
    const placeholders = flattenTags(tree)
    return { placeholders, unknown: placeholders.filter((p) => !isKnownPlaceholder(p)), error: null }
  } catch (e) {
    return { placeholders: [], unknown: [], error: errorText(e) }
  }
}

export function renderTemplate(buffer: ArrayBuffer, context: Record<string, unknown>): Blob {
  const doc = new Docxtemplater(new PizZip(buffer), {
    delimiters: DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    parser: dottedParser,
    nullGetter: () => '',
  })
  doc.render(context)
  return doc.getZip().generate({ type: 'blob', mimeType: DOCX_MIME }) as Blob
}
