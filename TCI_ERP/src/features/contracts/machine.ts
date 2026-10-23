/**
 * The contract-draft status machine and who may do what — a MIRROR of
 * migration 0057 (machine.test.ts locks it to the migration text). The
 * database enforces; this only decides which buttons to offer.
 *
 *   draft ──► under_review ──► agreed ──► signed (with the signed scan; final)
 *     ▲            │              │
 *     └────────────┘              │  back to draft: commercial underwriting,
 *     ▲                           │  with a reason
 *     └───────────────────────────┘
 */

import type { UserRole } from '../../lib/roles'

export const CONTRACT_STATUSES = ['draft', 'under_review', 'agreed', 'signed'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const VERSION_SOURCES = ['generated', 'manual', 'restored', 'refreshed'] as const
export type VersionSource = (typeof VERSION_SOURCES)[number]

/** tci.contract_draft_editable */
export const EDITABLE_STATUSES: readonly ContractStatus[] = ['draft', 'under_review']

/** tci.contract_transition_allowed, as 'from>to'. */
export const TRANSITIONS = [
  'draft>under_review',
  'under_review>draft',
  'under_review>agreed',
  'agreed>draft',
  'agreed>signed',
] as const

/** Who writes versions, generates, shares, submits for review and signs. */
export const WRITER_ROLES: readonly UserRole[] = ['commercial_underwriter', 'sales']
/** Who agrees a draft and reopens an agreed one. */
export const AGREE_ROLES: readonly UserRole[] = ['commercial_underwriter']
/** A draft can be shared with the policyholder in these statuses. */
export const SHAREABLE_STATUSES: readonly ContractStatus[] = ['under_review', 'agreed']
/** The client may comment on a shared draft in this status only. */
export const CLIENT_COMMENT_STATUS: ContractStatus = 'under_review'

export function isEditable(status: ContractStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return (TRANSITIONS as readonly string[]).includes(`${from}>${to}`)
}

const holds = (roles: readonly UserRole[], allowed: readonly UserRole[]) => roles.some((r) => allowed.includes(r))

export const canWrite = (roles: readonly UserRole[]) => holds(roles, WRITER_ROLES)
export const canAgree = (roles: readonly UserRole[]) => holds(roles, AGREE_ROLES)

export type StatusAction = 'submitForReview' | 'returnToDraft' | 'agree' | 'reopen' | 'sign'

export interface OfferedAction {
  action: StatusAction
  to: ContractStatus
  /** A comment the database requires (reopening an agreed draft). */
  needsReason: boolean
  primary: boolean
}

/** The status actions a person with these roles is offered on a draft. */
export function statusActions(status: ContractStatus, roles: readonly UserRole[]): OfferedAction[] {
  const out: OfferedAction[] = []
  if (!canWrite(roles)) return out
  if (status === 'draft') out.push({ action: 'submitForReview', to: 'under_review', needsReason: false, primary: true })
  if (status === 'under_review') {
    if (canAgree(roles)) out.push({ action: 'agree', to: 'agreed', needsReason: false, primary: true })
    out.push({ action: 'returnToDraft', to: 'draft', needsReason: false, primary: false })
  }
  if (status === 'agreed') {
    out.push({ action: 'sign', to: 'signed', needsReason: false, primary: true })
    if (canAgree(roles)) out.push({ action: 'reopen', to: 'draft', needsReason: true, primary: false })
  }
  return out
}

/** tci.contract_has_manual_edits: a manual or restored version after the
 * newest generated one. Regenerating over it needs confirmation. */
export function hasManualEdits(versions: readonly { version_no: number; source: VersionSource }[]): boolean {
  const lastGenerated = Math.max(0, ...versions.filter((v) => v.source === 'generated').map((v) => v.version_no))
  return versions.some((v) => (v.source === 'manual' || v.source === 'restored') && v.version_no > lastGenerated)
}

export function statusTone(status: ContractStatus): 'neutral' | 'warn' | 'accent' | 'pos' {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'under_review':
      return 'warn'
    case 'agreed':
      return 'accent'
    case 'signed':
      return 'pos'
  }
}
