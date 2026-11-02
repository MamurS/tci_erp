/** Credit analysis: the rating worklist and the sector grades. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'creditAnalyst'

export const CREDIT_ANALYST_TOUR: Tour = {
  id: 'credit_analyst',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'ratings', 'ratings-worklist', { route: '/limits?view=ratings', needsData: true }),
    own(K, 'sectors', 'section-tabs', { route: '/sectors' }),
    ...STAFF_CLOSING,
  ],
}
