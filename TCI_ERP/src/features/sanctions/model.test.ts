import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0091_sanctions_screening.sql?raw'
import { ENTRY_KINDS, LISTS, REQUIRED_LISTS } from './lists/parse'
import {
  LIST_REGIME,
  listOf,
  MATCH_STATUSES,
  mayEnterOwners,
  mayImportLists,
  mayResolveMatches,
  mayScreen,
  otherListName,
  OWNER_ROLES,
  SANCTIONS_STATUSES,
  SCREENING_REASONS,
  scorePercent,
  SEARCH_TOOLS,
  STALE_DAYS_BOUNDS,
  statusTone,
  SUBJECT_KINDS,
  THRESHOLD_BOUNDS,
} from './model'

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')
const flat = MIGRATION.replace(/\s+/g, ' ')

describe('vocabularies mirror 0091', () => {
  it('lists, kinds, statuses, subjects, reasons and roles are the checks of the tables', () => {
    expect(MIGRATION).toContain(`check (list in (${list(LISTS)}))`)
    expect(MIGRATION).toContain(`check (kind in (${list(ENTRY_KINDS)}))`)
    expect(MIGRATION).toContain(`check (status in (${list(MATCH_STATUSES)}))`)
    expect(MIGRATION).toContain(`check (subject_kind in (${list(SUBJECT_KINDS)}))`)
    expect(MIGRATION).toContain(`check (reason in (${list(SCREENING_REASONS)}))`)
    expect(MIGRATION).toContain(`check (role in (${list(OWNER_ROLES)}))`)
    expect(MIGRATION).toContain(`default '{${REQUIRED_LISTS.join(',')}}'`)
  })

  it('the status column follows the view, in its precedence', () => {
    const view = flat.slice(flat.indexOf('create view tci.v_entity_sanctions_status'), flat.indexOf('create view tci.v_sanctions_lists'))
    const order = [...view.matchAll(/then '(sanctioned|country|possible_match|not_screened|outdated)'/g)].map((m) => m[1])
    expect([...order, 'clear']).toEqual([...SANCTIONS_STATUSES])
    expect(view).toContain("else 'clear' end as status")
  })

  it('a list names its regime on a flag as the database does', () => {
    expect(MIGRATION).toContain(
      "select case p_list_key when 'ofac_sdn' then 'OFAC' when 'un' then 'UN' when 'eu' then 'EU' when 'uk' then 'UK' else 'other' end",
    )
    expect(LIST_REGIME).toEqual({ ofac_sdn: 'OFAC', un: 'UN', eu: 'EU', uk: 'UK', other: 'other' })
    expect(listOf('un')).toBe('un')
    expect(listOf('other:kazakh fiu')).toBe('other')
    expect(otherListName('other:kazakh fiu')).toBe('kazakh fiu')
    expect(otherListName('eu')).toBeNull()
  })

  it('mirrors the settings bounds', () => {
    expect(MIGRATION).toContain(`check (sanctions_match_threshold between ${THRESHOLD_BOUNDS.min.toFixed(2)} and ${THRESHOLD_BOUNDS.max.toFixed(2)})`)
    expect(MIGRATION).toContain(`check (sanctions_list_stale_days between ${STALE_DAYS_BOUNDS.min} and ${STALE_DAYS_BOUNDS.max})`)
  })
})

describe('who', () => {
  it('credit analysts resolve matches, as tci.resolve_sanctions_match', () => {
    expect(MIGRATION).toContain("perform tci.require_role('credit_analyst');\n  if p_outcome is null")
    expect(mayResolveMatches('credit_analyst')).toBe(true)
    for (const r of ['admin', 'credit_underwriter', 'sales', 'information_manager', 'client'] as const) expect(mayResolveMatches(r)).toBe(false)
  })

  it('credit analysts and admin import lists', () => {
    expect(MIGRATION).toContain("select tci.has_role('credit_analyst', 'admin')")
    expect(mayImportLists('credit_analyst')).toBe(true)
    expect(mayImportLists('admin')).toBe(true)
    expect(mayImportLists('credit_underwriter')).toBe(false)
  })

  it('the information desk and credit analysts record beneficial owners', () => {
    expect(MIGRATION).toContain("perform tci.require_role('information_manager', 'credit_analyst');")
    expect(mayEnterOwners('information_manager')).toBe(true)
    expect(mayEnterOwners('credit_analyst')).toBe(true)
    expect(mayEnterOwners('admin')).toBe(false)
  })

  it('every staff member screens and searches; a client never', () => {
    expect(MIGRATION).toContain('create function tci.screen_entity_now(p_entity uuid) returns jsonb\nlanguage plpgsql security definer set search_path = \'\' as $$\nbegin\n  perform tci.require_staff();')
    for (const r of ['admin', 'sales', 'claims', 'credit_analyst'] as const) expect(mayScreen(r)).toBe(true)
    expect(mayScreen('client')).toBe(false)
    expect(mayScreen(null)).toBe(false)
  })
})

describe('presentation', () => {
  it('never paints «clear» green', () => {
    expect(statusTone('sanctioned')).toBe('negStrong')
    expect(statusTone('country')).toBe('negStrong')
    expect(statusTone('possible_match')).toBe('warn')
    expect(statusTone('clear')).toBe('neutral')
  })

  it('scores read as per cent', () => {
    expect(scorePercent(0.9)).toBe(90)
    expect(scorePercent(0.667)).toBe(67)
  })

  it('only OpenSanctions takes the name in its address, encoded', () => {
    expect(SEARCH_TOOLS.filter((t) => t.takesName).map((t) => t.key)).toEqual(['opensanctions'])
    const os = SEARCH_TOOLS.find((t) => t.key === 'opensanctions')!
    expect(os.url(' ООО «Рога & Копыта» ')).toBe(
      `https://www.opensanctions.org/search/?q=${encodeURIComponent('ООО «Рога & Копыта»')}`,
    )
    for (const t of SEARCH_TOOLS) expect(t.url('x')).toMatch(/^https:\/\//)
  })
})
