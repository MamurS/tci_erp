/** Credit underwriting: the workbench, the decision queue and the decision form. */

import type { Tour } from '../types'
import { STAFF_CLOSING, STAFF_OPENING, own, welcome } from './shared'

const K = 'creditUnderwriter'

export const CREDIT_UNDERWRITER_TOUR: Tour = {
  id: 'credit_underwriter',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'workbench', 'section-tabs', { route: '/limits' }),
    own(K, 'queue', 'limits-queue', { route: '/limits?view=queue', needsData: true }),
    // The form behind the first request of the queue; no request, no form.
    own(K, 'decision', 'limit-decision', { route: '/limits?view=queue', openFirst: 'limits-queue', needsData: true }),
    ...STAFF_CLOSING,
  ],
}
