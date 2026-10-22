/** How a declaration's status is coloured, on the register and its page. */
import type { DeclarationStatus } from './types'

export const STATUS_TONE: Record<DeclarationStatus, 'neutral' | 'accent' | 'pos' | 'warn'> = {
  draft: 'neutral',
  submitted: 'accent',
  accepted: 'pos',
  disputed: 'warn',
  corrected: 'neutral',
}
