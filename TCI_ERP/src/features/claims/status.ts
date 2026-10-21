/** Badge tone per claim status — shared by the list, the claim page, its
 * history and the policy's claims section. Kept out of the page modules so
 * those export components only (fast refresh). */

import type { ClaimStatus } from './types'

export const CLAIM_STATUS_TONE: Record<ClaimStatus, 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'> = {
  draft: 'neutral',
  submitted: 'accent',
  under_assessment: 'accent',
  info_requested: 'warn',
  approved: 'pos',
  partially_approved: 'warn',
  declined: 'neg',
  paid: 'pos',
  closed: 'neutral',
  withdrawn: 'neutral',
}
