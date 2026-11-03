/**
 * The guided tour (Prompt 32): the steps are data and every one of them must
 * resolve — its texts in en/ru/uz, its anchor on a real component — and the
 * rule for what starts by itself mirrors 0098's record shape.
 */

import { describe, expect, it } from 'vitest'

import M98 from '../../../supabase/migrations/0098_tour_progress.sql?raw'
import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { USER_ROLES } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import { placeCard } from './dom'
import { ALL_TOUR_IDS, RELEASE_TOURS, ROLE_TOURS, tourById, tourForRole } from './registry'
import {
  TOUR_ID_PATTERN,
  TOUR_STATUSES,
  compareVersions,
  parseTourState,
  pendingReleases,
  pendingTours,
  recordTour,
  routeMatches,
  stepPosition,
} from './state'
import type { ReleaseTour, Tour, TourState } from './types'

const SOURCES = import.meta.glob(['../../**/*.tsx', '../../**/*.ts', '!../../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Anchors other workstreams put on their own components (Prompt 32): the
 * step is skipped while they are missing, so the tour never breaks on them. */
const EXTERNAL_ANCHORS: Record<string, string> = {
  help: 'the Help centre «?» button (src/features/help)',
  'demo-mode': 'the Demo mode switch (the demo-data workstream)',
}

const ALL_TOURS: readonly Tour[] = [...Object.values(ROLE_TOURS), ...RELEASE_TOURS]

function lookup(locale: unknown, key: string): unknown {
  let node = locale
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe('the tours are data that resolves', () => {
  it('every role has a tour, the portal its own, and ids are unique and valid', () => {
    for (const role of USER_ROLES) expect(tourForRole(role)).not.toBeNull()
    expect(ROLE_TOURS.client.id).toBe('client')
    expect(new Set(ALL_TOUR_IDS).size).toBe(ALL_TOUR_IDS.length)
    for (const id of ALL_TOUR_IDS) expect(id).toMatch(TOUR_ID_PATTERN)
    for (const tour of ALL_TOURS) expect(tourById(tour.id)).toBe(tour)
  })

  it('every step id is unique in its tour; a role tour opens and closes on a card', () => {
    for (const tour of ALL_TOURS) {
      const ids = tour.steps.map((s) => s.id)
      expect(new Set(ids).size, tour.id).toBe(ids.length)
    }
    for (const tour of Object.values(ROLE_TOURS)) {
      // A card that needs no anchor: the tour always has a first and a last step.
      expect(tour.steps[0]!.anchor, tour.id).toBeNull()
      expect(tour.steps.at(-1)!.anchor, tour.id).toBeNull()
    }
    for (const release of RELEASE_TOURS) expect(release.steps[0]!.anchor).toBeNull()
  })

  it('every title and text exists in en, ru and uz', () => {
    const missing: string[] = []
    for (const tour of ALL_TOURS)
      for (const step of tour.steps)
        for (const key of [step.titleKey, step.textKey])
          for (const [lang, locale] of [['en', en], ['ru', ru], ['uz', uz]] as const)
            if (typeof lookup(locale, key) !== 'string' || !(lookup(locale, key) as string).trim()) missing.push(`${lang}: ${key}`)
    for (const key of ['step', 'next', 'back', 'skip', 'done', 'takeTour', 'noData', 'portalPanel', 'portalPanelHint'])
      for (const [lang, locale] of [['en', en], ['ru', ru], ['uz', uz]] as const)
        if (typeof lookup(locale, `tour.ui.${key}`) !== 'string') missing.push(`${lang}: tour.ui.${key}`)
    expect(missing).toEqual([])
  })

  it('every anchor is a data-tour attribute on a real component (never a class)', () => {
    const code = Object.entries(SOURCES)
      .filter(([path]) => !path.includes('/features/tour/'))
      .map(([, text]) => text)
      .join('\n')
    const anchors = new Set(
      ALL_TOURS.flatMap((t) => t.steps.flatMap((s) => [s.anchor, s.openFirst].filter((a): a is string => Boolean(a)))),
    )
    const missing = [...anchors].filter(
      (a) =>
        !(a in EXTERNAL_ANCHORS) &&
        !code.includes(`data-tour="${a}"`) &&
        // AdminPage names one anchor per tab: data-tour={`admin-${activeTab}`}
        !(a.startsWith('admin-') && a !== 'admin-tabs' && code.includes('data-tour={`admin-${activeTab}`}')),
    )
    expect(missing).toEqual([])
  })

  it('the external anchors are skipped, never required: no tour consists of them alone', () => {
    for (const tour of ALL_TOURS) expect(tour.steps.some((s) => !s.anchor || !(s.anchor in EXTERNAL_ANCHORS))).toBe(true)
  })

  it('the queue steps say what they need, and the decision form is opened from its queue', () => {
    const decision = ROLE_TOURS.credit_underwriter.steps.find((s) => s.id === 'decision')!
    expect(decision).toMatchObject({ anchor: 'limit-decision', openFirst: 'limits-queue', needsData: true })
    for (const tour of Object.values(ROLE_TOURS))
      for (const step of tour.steps)
        if (step.anchor && /queue|requests|worklist|registry|list$/.test(step.anchor)) expect(step.needsData, `${tour.id}/${step.id}`).toBe(true)
  })

  it('every staff tour shows the workspace, the menu, the search, the user menu and help; the agenda unless it is the portal', () => {
    for (const role of USER_ROLES.filter((r) => r !== 'client')) {
      const anchors = ROLE_TOURS[role].steps.map((s) => s.anchor)
      for (const a of ['workspace-switcher', 'sidebar', 'search', 'agenda-views', 'user-menu', 'help']) expect(anchors, role).toContain(a)
    }
    expect(ROLE_TOURS.client.steps.length).toBeLessThan(ROLE_TOURS.sales.steps.length)
  })

  it('releases are listed oldest first with growing versions', () => {
    for (let i = 1; i < RELEASE_TOURS.length; i++)
      expect(compareVersions(RELEASE_TOURS[i]!.version, RELEASE_TOURS[i - 1]!.version)).toBeGreaterThan(0)
    for (const r of RELEASE_TOURS) {
      expect(r.version).toMatch(/^\d{4}\.\d{1,2}$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('the record mirrors 0098', () => {
  it('the id pattern and the statuses are the migration’s', () => {
    expect(M98).toContain('"^[a-z0-9][a-z0-9_.:-]{0,63}$"')
    expect(TOUR_ID_PATTERN.source).toBe('^[a-z0-9][a-z0-9_.:-]{0,63}$')
    for (const status of TOUR_STATUSES) expect(M98).toContain(`@.status == "${status}"`)
    expect(M98).toContain('@.last_step ? (@.type() == "number" && @ >= 0 && @ == @.floor())')
    expect(M98).toContain('grant select (ui_tour_state), update (ui_tour_state) on tci.user_profiles to authenticated;')
  })

  it('reads only well-formed entries', () => {
    expect(parseTourState(null)).toEqual({})
    expect(parseTourState([])).toEqual({})
    expect(
      parseTourState({
        sales: { status: 'completed', last_step: 3, at: '2026-11-02T10:00:00Z' },
        claims: { status: 'seen', last_step: 0, at: 'x' },
        admin: { status: 'skipped', last_step: -1, at: 'x' },
        'Bad Id': { status: 'skipped', last_step: 0, at: 'x' },
        client: { status: 'skipped', last_step: 1.5, at: 'x' },
      }),
    ).toEqual({ sales: { status: 'completed', last_step: 3, at: '2026-11-02T10:00:00Z' } })
  })

  it('records an outcome over an older one, as a whole step', () => {
    const at = new Date('2026-11-02T12:00:00Z')
    const state = recordTour({ sales: { status: 'skipped', last_step: 1, at: 'x' } }, 'sales', 'completed', 9.7, at)
    expect(state.sales).toEqual({ status: 'completed', last_step: 9, at: '2026-11-02T12:00:00.000Z' })
  })
})

describe('what starts by itself', () => {
  const at = (date: string) => ({ status: 'completed' as const, last_step: 0, at: `${date}T09:00:00.000Z` })
  const releases: ReleaseTour[] = [
    { id: 'release:2026.11', version: '2026.11', date: '2026-11-02', audience: 'staff', steps: [] },
    { id: 'release:2026.12', version: '2026.12', date: '2026-12-01', audience: 'all', steps: [] },
  ]

  it('a newcomer gets the acting role’s tour only', () => {
    const due = pendingTours({}, 'credit_analyst', releases)
    expect(due.map((t) => t.id)).toEqual(['credit_analyst'])
  })

  it('a completed or skipped tour never comes back by itself', () => {
    const state: TourState = { credit_analyst: at('2026-12-05'), sales: { ...at('2026-12-05'), status: 'skipped' } }
    expect(pendingTours(state, 'credit_analyst', releases)).toEqual([])
    expect(pendingTours(state, 'sales', releases)).toEqual([])
  })

  it('a role not toured yet gets its tour (a second workspace)', () => {
    expect(pendingTours({ sales: at('2026-12-05') }, 'claims', releases).map((t) => t.id)).toEqual(['claims'])
  })

  it('a release reaches those who were here before it, once, oldest first, newer than any seen', () => {
    const veteran: TourState = { sales: at('2026-10-01') }
    expect(pendingReleases(veteran, 'sales', releases).map((r) => r.id)).toEqual(['release:2026.11', 'release:2026.12'])
    expect(pendingReleases({ ...veteran, 'release:2026.11': at('2026-11-03') }, 'sales', releases).map((r) => r.id)).toEqual([
      'release:2026.12',
    ])
    // Seen the newer one: the older one is not shown afterwards.
    expect(pendingReleases({ ...veteran, 'release:2026.12': at('2026-12-02') }, 'sales', releases)).toEqual([])
    // Joined after a release: its role tour covered it.
    expect(pendingReleases({ sales: at('2026-11-20') }, 'sales', releases).map((r) => r.id)).toEqual(['release:2026.12'])
  })

  it('a release for staff is not shown in the portal', () => {
    expect(pendingReleases({ client: at('2026-10-01') }, 'client', releases).map((r) => r.id)).toEqual(['release:2026.12'])
  })

  it('no role, no tour', () => {
    expect(pendingTours({}, null as unknown as UserRole, releases)).toEqual([])
  })

  it('the stub of the e2e suite (every tour recorded) starts nothing', () => {
    const all: TourState = Object.fromEntries(ALL_TOUR_IDS.map((id) => [id, at('2026-01-01')]))
    for (const role of USER_ROLES) expect(pendingTours(all, role)).toEqual([])
  })
})

describe('routes, counting and placing', () => {
  it('a route matches its path and the query it names', () => {
    expect(routeMatches('/limits', '/limits', '?view=queue')).toBe(true)
    expect(routeMatches('/limits?view=queue', '/limits', '?view=queue&q=x')).toBe(true)
    expect(routeMatches('/limits?view=queue', '/limits', '')).toBe(false)
    expect(routeMatches('/limits?view=queue', '/limits/42', '?view=queue')).toBe(false)
  })

  it('counts only the steps that were shown', () => {
    expect(stepPosition(0, 10, new Set())).toEqual({ n: 1, of: 10 })
    expect(stepPosition(5, 10, new Set([1, 2, 7]))).toEqual({ n: 4, of: 7 })
  })

  it('puts the card below, above, beside, and always on screen', () => {
    const card = { width: 300, height: 200 }
    const vp = { width: 1280, height: 800 }
    expect(placeCard(null, card, vp, 12)).toEqual({ top: 300, left: 490 })
    expect(placeCard({ top: 100, left: 50, width: 200, height: 40 }, card, vp, 12)).toEqual({ top: 152, left: 50 })
    expect(placeCard({ top: 650, left: 50, width: 200, height: 40 }, card, vp, 12)).toEqual({ top: 438, left: 50 })
    expect(placeCard({ top: 20, left: 0, width: 256, height: 760 }, card, vp, 12)).toEqual({ top: 20, left: 268 })
    const pos = placeCard({ top: 0, left: 0, width: 1280, height: 800 }, card, vp, 12)
    expect(pos.top + card.height).toBeLessThanOrEqual(vp.height - 16)
    expect(pos.left).toBeGreaterThanOrEqual(16)
  })
})
