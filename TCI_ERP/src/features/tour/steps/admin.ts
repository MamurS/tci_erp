/** Administration: users and roles, authority, settings — a technical role. */

import type { Tour } from '../types'
import { AGENDA, FINISH, HELP, STAFF_OPENING, USER_MENU, own, welcome } from './shared'

const K = 'admin'

export const ADMIN_TOUR: Tour = {
  id: 'admin',
  steps: [
    welcome(K),
    ...STAFF_OPENING,
    own(K, 'tabs', 'admin-tabs', { route: '/admin' }),
    own(K, 'users', 'admin-users', { route: '/admin?tab=users' }),
    own(K, 'authorities', 'admin-authorities', { route: '/admin?tab=authorities' }),
    // Admin's Agenda holds admin's own tasks (the OECD list reminder): the
    // queue is shown, the department filters are not.
    AGENDA,
    USER_MENU,
    HELP,
    FINISH,
  ],
}
