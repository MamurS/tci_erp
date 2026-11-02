/** Sales: submissions, policies and the limit requests raised on clients' buyers. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'sales'

export const SALES_TOUR: Tour = {
  id: 'sales',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'requests', 'requests-queue', { route: '/requests', needsData: true }),
    own(K, 'policies', 'section-tabs', { route: '/policies' }),
    own(K, 'limits', 'limits-queue', { route: '/limits', needsData: true }),
    ...STAFF_CLOSING,
  ],
}
