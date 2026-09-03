/** Mapping the database's deliberate refusals to readable, translated messages.
 *
 * DESIGN.md: a rule the database enforces on purpose must never surface as a
 * raw server string or as "something went wrong". Each entry pairs a stable
 * fragment of the SQL `raise exception` text with an i18n key; a contract test
 * asserts every fragment still exists in the migrations, so a reworded
 * exception fails the build instead of silently falling back.
 *
 * The blocker keys returned by tci.claim_submission_blockers are already i18n
 * keys and need no mapping - they are rendered directly.
 */

export const CLAIM_REFUSALS: readonly { fragment: string; key: string }[] = [
  { fragment: 'this claim is not ready to be filed', key: 'claims.errors.notReady' },
  { fragment: 'only the policyholder, sales or claims may file a claim', key: 'claims.errors.notYoursToFile' },
  { fragment: 'only the policyholder, sales or claims may withdraw a claim', key: 'claims.errors.notYoursToWithdraw' },
  { fragment: 'only the policyholder or claims may resume assessment', key: 'claims.errors.notYoursToResume' },
  { fragment: 'only the claims department may move a claim', key: 'claims.errors.claimsOnly' },
  { fragment: 'declining a claim requires a reason', key: 'claims.errors.reasonRequired' },
  { fragment: 'invalid claim transition', key: 'claims.errors.invalidTransition' },
  { fragment: 'only the claims department may approve a claim', key: 'claims.errors.claimsOnly' },
  { fragment: 'computes to nothing payable', key: 'claims.errors.nothingPayable' },
  { fragment: 'is below the non-qualifying loss threshold', key: 'claims.errors.belowNql' },
  { fragment: 'cannot be approved', key: 'claims.errors.notAssessable' },
  { fragment: 'only the claims department may record an indemnity payment', key: 'claims.errors.claimsOnly' },
  { fragment: 'nothing has been approved on this claim yet', key: 'claims.errors.notApprovedYet' },
  { fragment: 'would exceed the approved indemnity', key: 'claims.errors.overpayment' },
  { fragment: 'only the claims department may record a recovery', key: 'claims.errors.claimsOnly' },
  { fragment: 'recovery costs must be between zero and the gross amount', key: 'claims.errors.recoveryCosts' },
  { fragment: 'a recovery needs a positive gross amount', key: 'claims.errors.recoveryAmount' },
  { fragment: 'only the claims department may override a coverage verdict', key: 'claims.errors.claimsOnly' },
  { fragment: 'an override needs a justification on the record', key: 'claims.errors.justificationRequired' },
  { fragment: 'cannot exceed what is claimable on the invoice', key: 'claims.errors.overrideTooLarge' },
  { fragment: 'a not_covered verdict covers nothing', key: 'claims.errors.overrideContradicts' },
  { fragment: 'can no longer be reassessed', key: 'claims.errors.settled' },
  { fragment: 'this claim can no longer be edited', key: 'claims.errors.locked' },
  { fragment: 'a claim needs a policy that was in force', key: 'claims.errors.policyNotInForce' },
  // Not a raise: these are unique-index violations, and the index NAME is the
  // only stable thing in the message Postgres produces.
  { fragment: 'claims_live_uq', key: 'claims.errors.alreadyOpen' },
  { fragment: 'claims_noa_uq', key: 'claims.errors.noaAlreadyClaimed' },
  { fragment: 'claim_invoices_number_per_claim', key: 'claims.errors.duplicateInvoice' },
  { fragment: 'claim_documents_storage_path_uq', key: 'claims.errors.duplicateDocument' },
  { fragment: 'not permitted to add documents to this claim', key: 'claims.errors.uploadNotAllowed' },
  { fragment: 'a claim document must live under', key: 'claims.errors.documentPath' },
  { fragment: 'a claim document must be between', key: 'claims.errors.documentSize' },
  { fragment: 'this file type is not accepted', key: 'claims.errors.documentType' },
  { fragment: 'this file extension is not accepted', key: 'claims.errors.documentType' },
  { fragment: 'not permitted to remove this document', key: 'claims.errors.deleteNotAllowed' },
  { fragment: 'an invoice needs its number', key: 'claims.errors.invoiceNumber' },
  { fragment: 'an invoice needs a positive amount', key: 'claims.errors.invoiceAmount' },
  { fragment: 'the due date cannot precede the invoice date', key: 'claims.errors.invoiceDates' },
  { fragment: 'paid and disputed amounts cannot exceed the invoice', key: 'claims.errors.invoiceSplit' },
  { fragment: 'claim not found', key: 'claims.errors.notFound' },
]

/** Returns the i18n key for a refusal, or null when this is not a rule we
 * recognise - in which case the caller shows the generic message, which is what
 * an unknown failure deserves and a deliberate refusal never does. */
export function claimErrorKey(error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message
  if (!message) return null
  const lower = message.toLowerCase()
  const hit = CLAIM_REFUSALS.find((r) => lower.includes(r.fragment.toLowerCase()))
  return hit ? hit.key : null
}
