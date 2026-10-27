/**
 * Reference country ratings (migration 0088): a credit insurer's published
 * country rating — today Allianz Trade's Country Risk Rating — shown beside
 * the OECD category and never used by a decision.
 *
 * Allianz Trade publishes two parts as one code: the medium-term Country
 * Grade (AA, A, BB, B, C, D; AA the lowest risk) and the short-term Country
 * Risk Level (1–4: low, medium, sensitive, high), e.g. «BB2». This module is
 * the screen's copy of the database's reading of that code
 * (tci.parse_reference_rating, contract-tested), the tone of the badge, who
 * may enter ratings, and the reader of a list pasted from the publication.
 */

import type { UserRole } from '../../lib/roles'
import { ALPHA3_TO_ALPHA2 } from '../admin/risk/iso3166'

export const REFERENCE_SOURCES = ['allianz_trade'] as const
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number]

/** Country Grade, lowest risk first (0088's check). */
export const REFERENCE_GRADES = ['AA', 'A', 'BB', 'B', 'C', 'D'] as const
export type ReferenceGrade = (typeof REFERENCE_GRADES)[number]

/** Country Risk Level 1–4 and its published label. */
export const REFERENCE_LEVELS = [1, 2, 3, 4] as const
export type ReferenceLevel = (typeof REFERENCE_LEVELS)[number]
export const LEVEL_LABEL: Record<ReferenceLevel, 'low' | 'medium' | 'sensitive' | 'high'> = {
  1: 'low',
  2: 'medium',
  3: 'sensitive',
  4: 'high',
}

/** The same pattern as tci.parse_reference_rating. */
export const RATING_PATTERN = /^(AA|A|BB|B|C|D)([1-4])$/

export interface ParsedRating {
  grade: ReferenceGrade
  level: ReferenceLevel
  /** The code as published, e.g. «BB2». */
  code: string
}

/** «bb2» → BB, 2; anything else → null. Case-blind, as the database. */
export function parseReferenceRating(text: string | null | undefined): ParsedRating | null {
  const m = RATING_PATTERN.exec((text ?? '').trim().toUpperCase())
  if (!m) return null
  const grade = m[1] as ReferenceGrade
  const level = Number(m[2]) as ReferenceLevel
  return { grade, level, code: `${grade}${level}` }
}

/**
 * The badge's tone follows the short-term level — the one Allianz Trade
 * labels low / medium / sensitive / high on its map — and is never green:
 * it is a reference, not a verdict of ours.
 */
export function referenceTone(level: number | null): 'neutral' | 'warn' | 'neg' {
  if (level === null) return 'neutral'
  if (level >= 4) return 'neg'
  if (level === 3) return 'warn'
  return 'neutral'
}

/** Who enters reference ratings: admin (reference data) and credit analysts. */
export function mayEnterReferenceRatings(actingRole: UserRole | null | undefined): boolean {
  return actingRole === 'admin' || actingRole === 'credit_analyst'
}

export type ReferenceListError =
  | { kind: 'line'; line: number; text: string }
  | { kind: 'country'; line: number; value: string }
  | { kind: 'rating'; line: number; value: string; code: string }
  | { kind: 'duplicate'; line: number; code: string; firstLine: number }

export interface ReferenceListParse {
  rows: { country_code: string; rating: string; line: number }[]
  errors: ReferenceListError[]
  /** Codes not in our reference list of countries: left out, named. */
  unknown: string[]
}

/**
 * A list pasted from the publication, one country per line:
 * «DE A1», «DEU;A1», «UZ, C3», «KZ\tBB2». The country is an ISO alpha-2 or
 * alpha-3 code; blank lines and lines starting with # are skipped. A code
 * our country list does not hold (`known`) is left out and named rather
 * than refusing the list; anything else wrong is an error by line.
 */
export function parseReferenceList(text: string, known: ReadonlySet<string>): ReferenceListParse {
  const rows: ReferenceListParse['rows'] = []
  const errors: ReferenceListError[] = []
  const unknown: string[] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const parts = t.split(/[\s,;]+/).filter(Boolean)
    if (parts.length !== 2) {
      errors.push({ kind: 'line', line, text: t })
      return
    }
    const [rawCode, rawRating] = parts as [string, string]
    const upper = rawCode.toUpperCase()
    const code = upper.length === 3 ? ALPHA3_TO_ALPHA2[upper] : /^[A-Z]{2}$/.test(upper) ? upper : undefined
    if (!code) {
      errors.push({ kind: 'country', line, value: rawCode })
      return
    }
    const rating = parseReferenceRating(rawRating)
    if (!rating) {
      errors.push({ kind: 'rating', line, value: rawRating, code })
      return
    }
    const first = seen.get(code)
    if (first !== undefined) {
      errors.push({ kind: 'duplicate', line, code, firstLine: first })
      return
    }
    seen.set(code, line)
    if (!known.has(code)) {
      unknown.push(code)
      return
    }
    rows.push({ country_code: code, rating: rating.code, line })
  })
  return { rows, errors, unknown }
}
