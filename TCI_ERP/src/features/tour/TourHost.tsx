/**
 * Starts tours. Mounted once in each shell (staff AppShell, PortalShell):
 *
 *   * by itself after sign-in, for what state.ts says is due — the acting
 *     role's tour the first time, then any «What's new» tour — one after the
 *     other while each is completed; Esc ends the queue for this session;
 *   * on the window event `tci:tour:start` (the Help page, «Take the tour» in
 *     the user menu and on the portal profile), with `detail.tour` naming a
 *     tour, 'release' for the latest «What's new», else the acting role's.
 *
 * Every outcome is recorded on the server (0098) and for this browser
 * session: a database without the column shows the tour once per session,
 * and a write the server refused does not bring it back before sign-out.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import type { UserRole } from '../../lib/roles'
import { useRecordTour, useTourState } from './api'
import { RELEASE_TOURS, TOUR_START_EVENT, tourById, tourForRole } from './registry'
import type { TourStartDetail } from './registry'
import { pendingTours } from './state'
import { TourOverlay } from './TourOverlay'
import type { Tour, TourRecord } from './types'

/** Screens that come before the work: no tour over them. */
const NOT_HERE = ['/change-password', '/no-access', '/mfa/verify']

const sessionKey = (userId: string, tourId: string) => `tci-erp-tour:${userId}:${tourId}`

function seenThisSession(userId: string, tourId: string): boolean {
  try {
    return window.sessionStorage.getItem(sessionKey(userId, tourId)) !== null
  } catch {
    return false
  }
}

function markSeenThisSession(userId: string, tourId: string) {
  try {
    window.sessionStorage.setItem(sessionKey(userId, tourId), '1')
  } catch {
    // without storage the server's record still holds
  }
}

function requestedTour(detail: TourStartDetail | null | undefined, role: UserRole | null): Tour | null {
  if (detail?.tour === 'release') {
    const audience = role === 'client' ? 'client' : 'staff'
    return RELEASE_TOURS.filter((r) => r.audience === 'all' || r.audience === audience).at(-1) ?? null
  }
  if (detail?.tour) return tourById(detail.tour)
  return tourForRole(role)
}

interface Run {
  tour: Tour
  queue: readonly Tour[]
  /** A fresh overlay for every start, even of the same tour. */
  key: number
}

export function TourHost() {
  const { session, actingRole, loading, mustChangePassword } = useAuth()
  const userId = session?.user.id ?? null
  const { pathname } = useLocation()
  const progress = useTourState()
  const record = useRecordTour()
  const [run, setRun] = useState<Run | null>(null)
  const checked = useRef<string | null>(null)
  const counter = useRef(0)
  const roleRef = useRef(actingRole)
  roleRef.current = actingRole

  // By itself, once per (person, acting role) and page load.
  useEffect(() => {
    if (!userId || loading || !actingRole || mustChangePassword || !progress.ready || run) return
    if (NOT_HERE.some((p) => pathname.startsWith(p))) return
    const key = `${userId}:${actingRole}`
    if (checked.current === key) return
    checked.current = key
    const due = (progress.available ? pendingTours(progress.state, actingRole) : [tourForRole(actingRole)]).filter(
      (tour): tour is Tour => tour !== null && !seenThisSession(userId, tour.id),
    )
    if (due.length) setRun({ tour: due[0]!, queue: due.slice(1), key: ++counter.current })
  }, [userId, loading, actingRole, mustChangePassword, progress.ready, progress.available, progress.state, run, pathname])

  // On request.
  useEffect(() => {
    const onStart = (event: Event) => {
      const tour = requestedTour((event as CustomEvent<TourStartDetail>).detail, roleRef.current)
      if (tour) setRun({ tour, queue: [], key: ++counter.current })
    }
    window.addEventListener(TOUR_START_EVENT, onStart)
    return () => window.removeEventListener(TOUR_START_EVENT, onStart)
  }, [])

  const { mutate } = record
  const runRef = useRef(run)
  runRef.current = run
  const close = useCallback(
    (status: TourRecord['status'], lastStep: number) => {
      const current = runRef.current
      if (!current) return
      if (userId) markSeenThisSession(userId, current.tour.id)
      mutate({ tourId: current.tour.id, status, lastStep })
      const [next, ...rest] = current.queue
      setRun(status === 'completed' && next ? { tour: next, queue: rest, key: ++counter.current } : null)
    },
    [userId, mutate],
  )

  if (!run) return null
  return <TourOverlay key={run.key} tour={run.tour} onClose={close} />
}
