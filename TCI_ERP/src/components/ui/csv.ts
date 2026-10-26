/**
 * A CSV of what is on screen, for the bulk bar's «Export» (Prompt 30): the
 * rows a person selected, the columns they see, as text. RFC 4180 quoting;
 * a cell that starts with = + - @ is prefixed with ' so a spreadsheet never
 * runs it as a formula (CSV injection). UTF-8 with a BOM, so Excel reads
 * Cyrillic and Uzbek letters.
 */

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** Hands the CSV to the browser as a download. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
