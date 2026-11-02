/**
 * «What's new» tours, one per release (Prompt 32). Shown once after sign-in
 * to the people who were here before the release (their first recorded tour
 * is older than its date), oldest first; someone who joins later learns the
 * same things from their role tour. Add a release at the END, with a version
 * greater than the last (releases.test.ts).
 */

import type { ReleaseTour } from '../types'
import { own } from './shared'

const K = 'release202611'

export const RELEASE_TOURS: readonly ReleaseTour[] = [
  {
    id: 'release:2026.11',
    version: '2026.11',
    date: '2026-11-02',
    audience: 'staff',
    steps: [
      own(K, 'intro', null),
      // The Help centre and Demo mode are their own workstreams: each step is
      // skipped while its anchor is not on screen.
      own(K, 'help', 'help'),
      own(K, 'demo', 'demo-mode'),
    ],
  },
]
