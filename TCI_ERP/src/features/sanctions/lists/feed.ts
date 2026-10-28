/**
 * The daily feed of the official sanctions lists (migration 0095,
 * `.github/workflows/sanctions-lists.yml`, `tools/sanctions-feed/run.mjs`):
 * where each list is published, which date it is imported under, and how
 * the database's answers read. Pure, and free of imports other than types,
 * so Node runs it as is (`--experimental-strip-types`) next to `parse.ts`.
 */

import type { SanctionsList } from './parse'

export type FeedList = Exclude<SanctionsList, 'other'>

export interface FeedSource {
  list: FeedList
  /** the file name recorded on the import */
  file: string
  url: string
  /** OFAC publishes the aliases in a second file */
  aliasUrl?: string
}

/** The publishers' own files — free, without a key, the ones the import screen takes. */
export const FEED_SOURCES: readonly FeedSource[] = [
  {
    list: 'ofac_sdn',
    file: 'sdn.csv',
    url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
    aliasUrl: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV',
  },
  { list: 'un', file: 'consolidated.xml', url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml' },
  {
    list: 'eu',
    file: 'csvFullSanctionsList_1_1.csv',
    // The token is the EU's own public one, printed in its download link
    // (base64 of "token-2017") — not a secret.
    url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw', // gitleaks:allow
  },
  { list: 'uk', file: 'UK-Sanctions-List.csv', url: 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv' },
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The publication date an import is recorded under: the date the file states
 * (UN, EU, UK), else the day the publisher last changed it (OFAC's CSV states
 * none; its `Last-Modified` header does), never later than today — the
 * database refuses a date in the future. Null when neither is known.
 */
export function feedPublishedAt(stated: string | null, lastModified: string | null, today: string): string | null {
  let date: string | null = null
  if (stated && ISO_DATE.test(stated.slice(0, 10))) {
    date = stated.slice(0, 10)
  } else if (lastModified) {
    const t = Date.parse(lastModified)
    if (Number.isFinite(t)) date = new Date(t).toISOString().slice(0, 10)
  }
  if (!date) return null
  return date > today ? today : date
}

/**
 * What a refusal from begin / finish means for the feed. `unchanged` and
 * `older` are a quiet day; `shrunk` waits for a person (0095 refuses the
 * feed's confirmation); anything else is a failure the job reports.
 */
export type FeedRefusal = 'unchanged' | 'older' | 'shrunk' | 'failed'

export function feedRefusal(message: string): FeedRefusal {
  if (message.includes('sanctions_list_same')) return 'unchanged'
  if (message.includes('sanctions_list_older')) return 'older'
  if (message.includes('sanctions_list_shrunk')) return 'shrunk'
  return 'failed'
}
