/** Commercial underwriting: policy terms, submissions at commercial review,
 * the commercial stage of limit decisions. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'commercial'

export const COMMERCIAL_UNDERWRITER_TOUR: Tour = {
  id: 'commercial_underwriter',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'policies', 'section-tabs', { route: '/policies' }),
    own(K, 'requests', 'requests-queue', { route: '/requests', needsData: true }),
    own(K, 'limits', 'limits-queue', { route: '/limits', needsData: true }),
    ...STAFF_CLOSING,
  ],
}
