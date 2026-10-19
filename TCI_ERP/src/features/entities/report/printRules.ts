/**
 * Helpers for the report's @page rules (pure). The footer is drawn in the
 * page margin boxes, whose `content` must be CSS literals and counters.
 */

/** A CSS string literal. */
export function cssString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')}"`
}

/**
 * A translated "Page {{page}} of {{pages}}", rendered with two sentinel
 * characters in place of the numbers, turned into a margin-box `content`:
 * `"Page " counter(page) " of " counter(pages)`. Works for any word order.
 */
export function pageCounterContent(rendered: string, page: string, pages: string): string {
  return rendered
    .split(new RegExp(`(${page}|${pages})`))
    .filter((part) => part !== '')
    .map((part) =>
      part === page ? 'counter(page)' : part === pages ? 'counter(pages)' : cssString(part),
    )
    .join(' ')
}
