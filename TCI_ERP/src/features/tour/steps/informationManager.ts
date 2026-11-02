/** Data management: requests for companies and statements, freshness, the registry. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'information'

export const INFORMATION_MANAGER_TOUR: Tour = {
  id: 'information_manager',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'requests', 'data-requests', { route: '/data', needsData: true }),
    own(K, 'views', 'section-tabs', { route: '/data' }),
    own(K, 'entities', 'entities-registry', { route: '/entities', needsData: true }),
    ...STAFF_CLOSING,
  ],
}
