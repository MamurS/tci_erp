/** The policyholder portal: shorter, in the policyholder's words. */

import type { Tour } from '../types'
import { own } from './shared'

const K = 'portal'

export const PORTAL_TOUR: Tour = {
  id: 'client',
  steps: [
    own(K, 'welcome', null),
    own(K, 'sections', 'portal-nav'),
    own(K, 'requestLimit', 'portal-request-limit', { route: '/portal/limits' }),
    own(K, 'profile', 'display-settings', { route: '/portal/account' }),
    own(K, 'help', 'help'),
    own(K, 'finish', null),
  ],
}
