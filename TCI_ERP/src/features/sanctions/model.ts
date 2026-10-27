/**
 * Sanctions screening (migration 0091) — the vocabularies the database
 * accepts (contract-tested against the migration), who may do what, and the
 * official search tools every staff member may use by hand. Nothing here
 * decides: the database screens, a credit analyst confirms or clears.
 */

import type { UserRole } from '../../lib/roles'
import type { SanctionsList } from './lists/parse'

/** The views of «Санкции» (?view=); an unknown one opens the check. */
export const SANCTIONS_VIEWS = ['check', 'matches', 'lists', 'flags'] as const
export type SanctionsView = (typeof SANCTIONS_VIEWS)[number]

export function parseSanctionsView(raw: string | null): SanctionsView {
  return (SANCTIONS_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as SanctionsView) : 'check'
}

/** tci.v_entity_sanctions_status.status, in the view's precedence. */
export const SANCTIONS_STATUSES = ['sanctioned', 'country', 'possible_match', 'not_screened', 'outdated', 'clear'] as const
export type SanctionsStatus = (typeof SANCTIONS_STATUSES)[number]

export const MATCH_STATUSES = ['pending', 'confirmed', 'cleared', 'retired'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const SUBJECT_KINDS = ['entity', 'owner', 'beneficial_owner'] as const
export type SubjectKind = (typeof SUBJECT_KINDS)[number]

export const SCREENING_REASONS = ['rating', 'limit_request', 'list_import', 'owners_changed', 'manual'] as const
export type ScreeningReason = (typeof SCREENING_REASONS)[number]

export const OWNER_ROLES = ['beneficial_owner', 'shareholder', 'director'] as const
export type OwnerRole = (typeof OWNER_ROLES)[number]

/** The regime a list stands for on a flag (tci.sanctions_list_regime). */
export const LIST_REGIME: Record<SanctionsList, 'OFAC' | 'UN' | 'EU' | 'UK' | 'other'> = {
  ofac_sdn: 'OFAC',
  un: 'UN',
  eu: 'EU',
  uk: 'UK',
  other: 'other',
}

/** A list key as stored: one of the four, or «other:<name>». */
export function listOf(listKey: string): SanctionsList {
  return listKey === 'ofac_sdn' || listKey === 'un' || listKey === 'eu' || listKey === 'uk' ? listKey : 'other'
}

/** The name of another list, from its key. */
export function otherListName(listKey: string): string | null {
  return listKey.startsWith('other:') ? listKey.slice(6) : null
}

/** Who resolves a match: credit analysts (tci.resolve_sanctions_match). */
export function mayResolveMatches(actingRole: UserRole | null | undefined): boolean {
  return actingRole === 'credit_analyst'
}

/** Who imports the lists: credit analysts and admin (tci.may_import_sanctions_lists). */
export function mayImportLists(actingRole: UserRole | null | undefined): boolean {
  return actingRole === 'credit_analyst' || actingRole === 'admin'
}

/** Who records beneficial owners: the information desk and credit analysts. */
export function mayEnterOwners(actingRole: UserRole | null | undefined): boolean {
  return actingRole === 'information_manager' || actingRole === 'credit_analyst'
}

/** Every staff member may screen a company now and use the search. */
export function mayScreen(actingRole: UserRole | null | undefined): boolean {
  return actingRole !== null && actingRole !== undefined && actingRole !== 'client'
}

/** The status's tone on a badge: red for a sanction, amber for what needs a
 * look, never green for «clear» (screening finds possible matches; it does
 * not certify anyone). */
export function statusTone(status: SanctionsStatus): 'negStrong' | 'warn' | 'neutral' {
  if (status === 'sanctioned' || status === 'country') return 'negStrong'
  if (status === 'possible_match') return 'warn'
  return 'neutral'
}

/** A score as a per cent («92 %»), for the match tables. */
export function scorePercent(score: number): number {
  return Math.round(Number(score) * 100)
}

// ---------------------------------------------------------------------------
// The official tools, for checking by hand
// ---------------------------------------------------------------------------

export interface SearchTool {
  key: 'ofac' | 'un' | 'eu' | 'uk' | 'opensanctions'
  /** Opens the publisher's own search; a name is filled in only where the
   * tool accepts one in its address. */
  url: (name: string) => string
  /** Whether `url` carries the name (otherwise the person pastes it). */
  takesName: boolean
}

export const SEARCH_TOOLS: readonly SearchTool[] = [
  { key: 'ofac', url: () => 'https://sanctionssearch.ofac.treas.gov/', takesName: false },
  { key: 'un', url: () => 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list', takesName: false },
  { key: 'eu', url: () => 'https://www.sanctionsmap.eu/', takesName: false },
  { key: 'uk', url: () => 'https://search-uk-sanctions-list.service.gov.uk/', takesName: false },
  {
    key: 'opensanctions',
    url: (name) => `https://www.opensanctions.org/search/?q=${encodeURIComponent(name.trim())}`,
    takesName: true,
  },
]

/** Where each official list file is published (the import screen links them). */
export const LIST_DOWNLOADS: Readonly<Record<Exclude<SanctionsList, 'other'>, readonly string[]>> = {
  ofac_sdn: ['https://www.treasury.gov/ofac/downloads/sdn.csv', 'https://www.treasury.gov/ofac/downloads/alt.csv'],
  un: ['https://scsanctions.un.org/resources/xml/en/consolidated.xml'],
  eu: ['https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw'],
  uk: ['https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv'],
}

/** The settings form's bounds (the 0091 checks). */
export const THRESHOLD_BOUNDS = { min: 0.3, max: 1 } as const
export const STALE_DAYS_BOUNDS = { min: 1, max: 365 } as const
