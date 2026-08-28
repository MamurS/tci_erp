/**
 * The declaration status machine — pure mirror of
 * tci.declaration_transition_allowed (migration 0026).
 *
 * The database enforces it; this exists so a screen can grey out a button
 * instead of offering an action it knows will be refused.
 */

import type { DeclarationStatus } from './types'

const TRANSITIONS: Readonly<Record<DeclarationStatus, readonly DeclarationStatus[]>> = {
  draft: ['submitted'],
  submitted: ['accepted', 'disputed'],
  disputed: ['submitted', 'corrected'],
  accepted: ['corrected'],
  corrected: [],
}

export function canTransition(from: DeclarationStatus, to: DeclarationStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** `corrected` is never offered as a bare transition: it only happens through
 * tci.correct_declaration, which creates the replacement in the same breath.
 * Offering it alone would strand a period with no live declaration. */
const NOT_OFFERED_DIRECTLY: readonly DeclarationStatus[] = ['corrected']

export function transitionsOffered(from: DeclarationStatus): readonly DeclarationStatus[] {
  return TRANSITIONS[from].filter((to) => !NOT_OFFERED_DIRECTLY.includes(to))
}

/** Editable means the policyholder can still change the lines. */
export function isEditable(status: DeclarationStatus): boolean {
  return status === 'draft' || status === 'disputed'
}

/** Only an accepted or disputed declaration can be corrected. */
export function canCorrect(status: DeclarationStatus): boolean {
  return canTransition(status, 'corrected')
}
