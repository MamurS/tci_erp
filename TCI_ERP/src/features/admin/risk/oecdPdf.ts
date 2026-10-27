/**
 * Admin › Риски › the OECD's own list, as published: the PDF «Country Risk
 * Classifications of the Participants to the Arrangement on Officially
 * Supported Export Credits» (cre-crc-current-english.pdf). This module reads
 * its TEXT LINES — oecdPdfReader.ts turns the PDF into lines — and gives the
 * same OecdParse the CSV / Excel path gives, so the preview and the import
 * are one screen.
 *
 * What a line looks like:
 *
 *   11   AUT   Austria                 -   -   (6) (7)
 *   32   CMR   Cameroon                6   7   (9)
 *   nb   ISO alpha-3   name   previous   CURRENT (prevailing)   notes
 *
 * The rules, said on the screen as well:
 *   * the CURRENT (prevailing) category is the one imported;
 *   * alpha-3 codes become alpha-2 through the ISO table (iso3166.ts); a code
 *     the table does not hold is refused by name, never guessed;
 *   * a «-» is explained by the row's footnotes, whose meanings are read from
 *     the footnote list at the end of the PDF — never assumed by number,
 *     because the OECD renumbers them between editions:
 *       - a note saying «High Income» or «euro» (high-income OECD countries,
 *         the euro area, euro micro-states) → category 0, the export credit
 *         practice for countries the OECD does not classify because they are
 *         high income — imported with a visible warning;
 *       - otherwise a note saying «not reviewed or classified» → left out:
 *         the country is NOT CLASSIFIED (the database reads a missing country
 *         that way, never as 0);
 *       - a «-» no note explains is an error, by row.
 *   * the date after «Valid as of» is suggested as the effective date.
 */

import { ALPHA3_TO_ALPHA2 } from './iso3166'
import { dateInText } from './oecdImport'
import type { OecdError, OecdParse, OecdRow } from './oecdImport'

/** What a footnote means for a «-» row. `other`: informational only. */
export type OecdNoteMeaning = 'high_income' | 'not_classified' | 'other'

export interface OecdPdfParse {
  parse: OecdParse
  /** The «Valid as of» date, ISO, or null. */
  fileDate: string | null
  /** Footnote number → what it means, as read from the PDF. */
  notes: Record<number, OecdNoteMeaning>
}

/** The country lines: «nb ISO3 name previous current (notes)». */
const ROW = /^\s*(\d{1,3})\s+([A-Z]{3})\s+(.+?)\s+(\d|[-–—])\s+(\d|[-–—])((?:\s*\(\d{1,2}\))*)\s*$/
/** A footnote definition: «(6) High Income OECD Country not reviewed…». */
const NOTE = /^\s*\((\d{1,2})\)\s+(.+?)\s*$/

/** What a footnote's text says about a «-» row. */
export function noteMeaning(text: string): OecdNoteMeaning {
  const t = text.toLowerCase()
  if (/high[\s-]*income|\beuro\b/.test(t)) return 'high_income'
  if (/not\s+reviewed\s+or\s+classified/.test(t)) return 'not_classified'
  return 'other'
}

function noteNumbers(text: string): number[] {
  return [...text.matchAll(/\((\d{1,2})\)/g)].map((m) => Number(m[1]))
}

function isDash(cell: string): boolean {
  return /^[-–—]$/.test(cell)
}

/** The OECD PDF's lines → the import's parse. */
export function parseOecdPdfLines(lines: readonly string[]): OecdPdfParse {
  // Footnote meanings first: rows refer to them by number.
  const notes: Record<number, OecdNoteMeaning> = {}
  for (const line of lines) {
    if (ROW.test(line)) continue
    const m = NOTE.exec(line)
    if (m) {
      const n = Number(m[1])
      // The first definition wins; a later «(1) not the lowest risk obligor»
      // inside another note's text is not a definition.
      if (!(n in notes)) notes[n] = noteMeaning(m[2]!)
    }
  }

  let fileDate: string | null = null
  for (const line of lines) {
    const at = /valid\s+as\s+of\s*:?\s*(.+)$/i.exec(line)
    if (at) {
      fileDate = dateInText(at[1]!)
      if (fileDate) break
    }
  }

  const rows: OecdRow[] = []
  const errors: OecdError[] = []
  const skippedCodes: string[] = []
  const seen = new Map<string, number>()

  for (const line of lines) {
    const m = ROW.exec(line)
    if (!m) continue
    const nb = Number(m[1])
    const alpha3 = m[2]!
    const current = m[5]!
    const rowNotes = noteNumbers(m[6] ?? '')
    const code = ALPHA3_TO_ALPHA2[alpha3]
    if (!code) {
      errors.push({ kind: 'code_invalid', row: nb, value: alpha3 })
      continue
    }
    const first = seen.get(code)
    if (first !== undefined) {
      errors.push({ kind: 'duplicate', row: nb, code, firstRow: first })
      continue
    }
    seen.set(code, nb)

    if (!isDash(current)) {
      rows.push({ row: nb, country_code: code, category: Number(current), warnings: [], notes: rowNotes })
      continue
    }
    const meanings = rowNotes.map((n) => notes[n])
    if (meanings.includes('high_income')) {
      rows.push({ row: nb, country_code: code, category: 0, warnings: ['highIncomeZero'], notes: rowNotes })
    } else if (meanings.includes('not_classified')) {
      skippedCodes.push(code)
    } else {
      errors.push({ kind: 'dash_unexplained', row: nb, value: rowNotes.map((n) => `(${n})`).join(' ') || '—', code })
    }
  }

  if (rows.length === 0 && errors.length === 0) errors.push({ kind: 'empty' })
  return {
    parse: { rows, errors, skipped: skippedCodes.length, skippedCodes, headerIndex: null },
    fileDate,
    notes,
  }
}
