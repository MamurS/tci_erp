/**
 * A company's public ratings by rating agencies (migration 0088), for the
 * company card: the agencies and the values the database accepts
 * (contract-tested), who may enter them, how the agency is named, and —
 * for the three international agencies' long-term scales — whether a
 * rating is investment or speculative grade. A reference beside our own
 * grade, never in its place: nothing that decides reads it.
 */

import type { UserRole } from '../../../lib/roles'

export const AGENCIES = ['sp', 'moodys', 'fitch', 'ahbor_reyting', 'saipro', 'acra', 'expert_ra', 'other'] as const
export type Agency = (typeof AGENCIES)[number]

export const SCALES = ['international', 'national'] as const
export type AgencyScale = (typeof SCALES)[number]

export const TERMS = ['long', 'short'] as const
export type AgencyTerm = (typeof TERMS)[number]

export const OUTLOOKS = [
  'positive',
  'stable',
  'negative',
  'developing',
  'watch_positive',
  'watch_negative',
  'watch_developing',
] as const
export type AgencyOutlook = (typeof OUTLOOKS)[number]

/** The database's check on a rating as an agency writes it. */
export const AGENCY_RATING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+./() -]{0,19}$/

/** Agency names are proper names: the same in every language. */
export const AGENCY_NAME: Record<Exclude<Agency, 'other'>, string> = {
  sp: 'S&P Global Ratings',
  moodys: "Moody's",
  fitch: 'Fitch Ratings',
  ahbor_reyting: 'Ahbor-Reyting',
  saipro: 'SAIPRO',
  acra: 'ACRA',
  expert_ra: 'Expert RA',
}

/** Short form for a line of text (the quick facts). */
export const AGENCY_SHORT: Record<Exclude<Agency, 'other'>, string> = {
  sp: 'S&P',
  moodys: "Moody's",
  fitch: 'Fitch',
  ahbor_reyting: 'Ahbor-Reyting',
  saipro: 'SAIPRO',
  acra: 'ACRA',
  expert_ra: 'Expert RA',
}

export function agencyName(agency: Agency, other: string | null | undefined, short = false): string {
  if (agency === 'other') return other?.trim() || '—'
  return (short ? AGENCY_SHORT : AGENCY_NAME)[agency]
}

/** Who enters agency ratings: the information desk and credit analysts. */
export function mayEnterAgencyRatings(actingRole: UserRole | null | undefined): boolean {
  return actingRole === 'information_manager' || actingRole === 'credit_analyst'
}

export function isValidAgencyRating(text: string): boolean {
  return AGENCY_RATING_PATTERN.test(text.trim())
}

// S&P and Fitch share the long-term scale; BBB- and above is investment grade.
const SP_FITCH_LONG = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-']
const SP_FITCH_SPECULATIVE = ['BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'RD', 'SD', 'D']
// Moody's: Baa3 and above.
const MOODYS_LONG = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3']
const MOODYS_SPECULATIVE = ['Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C']

/**
 * Investment or speculative grade — only for S&P, Moody's and Fitch on the
 * international long-term scale, where the boundary is the agencies' own
 * (BBB- / Baa3). Anything else (a national scale, a short-term rating, a
 * withdrawn one, an unrecognised code) is null: no class is invented.
 */
export function gradeClass(
  agency: Agency,
  scale: AgencyScale,
  term: AgencyTerm,
  rating: string | null,
): 'investment' | 'speculative' | null {
  if (!rating || scale !== 'international' || term !== 'long') return null
  const r = rating.trim()
  if (agency === 'sp' || agency === 'fitch') {
    const u = r.toUpperCase()
    if (SP_FITCH_LONG.includes(u)) return 'investment'
    if (SP_FITCH_SPECULATIVE.includes(u)) return 'speculative'
    return null
  }
  if (agency === 'moodys') {
    if (MOODYS_LONG.includes(r)) return 'investment'
    if (MOODYS_SPECULATIVE.includes(r)) return 'speculative'
    return null
  }
  return null
}

/** The outlook's tone: watch and negative read amber, never green. */
export function outlookTone(outlook: AgencyOutlook | null): 'neutral' | 'warn' {
  return outlook === 'negative' || outlook === 'watch_negative' ? 'warn' : 'neutral'
}

/** A reference that is a web address becomes a link; anything else stays text. */
export function referenceUrl(reference: string): string | null {
  const t = reference.trim()
  return /^https?:\/\/[^\s]+$/i.test(t) ? t : null
}
