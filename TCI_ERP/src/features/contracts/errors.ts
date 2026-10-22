/** Readable messages for the contract-draft refusals of migration 0057
 * (errors.test.ts asserts every fragment still exists in the migration),
 * falling back to the wording refusals and then the shared SQLSTATE mapping.
 * Never raw server text. */

import { wordingErrorKey } from '../wording/errors'

export const CONTRACT_REFUSALS: readonly { fragment: string; key: string }[] = [
  { fragment: 'contract_draft_exists', key: 'contractDrafts.errors.exists' },
  { fragment: 'contract_target_not_live', key: 'contractDrafts.errors.targetNotLive' },
  { fragment: 'contract_not_editable', key: 'contractDrafts.errors.notEditable' },
  { fragment: 'contract_version_conflict', key: 'contractDrafts.errors.conflict' },
  { fragment: 'contract_version_unchanged', key: 'contractDrafts.errors.unchanged' },
  { fragment: 'contract_manual_edits_unconfirmed', key: 'contractDrafts.errors.manualEdits' },
  { fragment: 'contract_refresh_changed_text', key: 'contractDrafts.errors.refreshChangedText' },
  { fragment: 'contract_content_invalid', key: 'contractDrafts.errors.contentInvalid' },
  { fragment: 'contract_transition_not_allowed', key: 'contractDrafts.errors.transition' },
  { fragment: 'contract_reason_required', key: 'contractDrafts.errors.reasonRequired' },
  { fragment: 'contract_sign_needs_scan', key: 'contractDrafts.errors.signNeedsScan' },
  { fragment: 'contract_signed_final', key: 'contractDrafts.errors.signedFinal' },
  { fragment: 'contract_scan_invalid_path', key: 'contractDrafts.errors.scanInvalid' },
  { fragment: 'contract_scan_missing', key: 'contractDrafts.errors.scanMissing' },
  { fragment: 'contract_share_not_allowed', key: 'contractDrafts.errors.shareNotAllowed' },
  { fragment: 'contract_comment_closed', key: 'contractDrafts.errors.commentClosed' },
  { fragment: 'contract_comment_empty', key: 'contractDrafts.errors.commentEmpty' },
  { fragment: 'contract_comment_too_long', key: 'contractDrafts.errors.commentTooLong' },
  { fragment: 'only commercial underwriting may agree a contract', key: 'contractDrafts.errors.agreeCommercialOnly' },
]

export function contractErrorKey(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string') {
    const hit = CONTRACT_REFUSALS.find((r) => message.includes(r.fragment))
    if (hit) return hit.key
    if (/mime type|not supported|invalid_mime/i.test(message)) return 'contractDrafts.errors.scanNotPdf'
    if (/exceeded the maximum allowed size|payload too large/i.test(message)) return 'contractDrafts.errors.scanTooLarge'
  }
  return wordingErrorKey(error)
}
