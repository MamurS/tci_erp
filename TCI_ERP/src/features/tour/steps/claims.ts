/** Claims: the claims queue and the overdue accounts before them. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'claims'

export const CLAIMS_TOUR: Tour = {
  id: 'claims',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'queue', 'claims-queue', { route: '/claims', needsData: true }),
    own(K, 'overdues', 'overdues-list', { route: '/overdues', needsData: true }),
    ...STAFF_CLOSING,
  ],
}
