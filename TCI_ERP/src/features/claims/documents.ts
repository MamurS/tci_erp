/** The required-document checklist, mirrored from tci.required_claim_documents
 * (migration 0035).
 *
 * Insolvency swaps the dunning trail for formal evidence: chasing a company in
 * administration proves nothing. The database refuses submission while a
 * mandatory type is missing; this mirror only draws the checklist.
 */

import type { CauseOfLoss, ClaimDocumentType } from './types'

export const REQUIRED_DOCUMENTS: Readonly<Record<CauseOfLoss, readonly ClaimDocumentType[]>> = {
  protracted_default: ['invoice', 'shipping', 'dunning'],
  insolvency: ['invoice', 'shipping', 'insolvency_evidence'],
  other: ['invoice'],
}

export function requiredDocuments(cause: CauseOfLoss): readonly ClaimDocumentType[] {
  return REQUIRED_DOCUMENTS[cause]
}

export function missingDocuments(
  cause: CauseOfLoss,
  present: readonly ClaimDocumentType[],
): ClaimDocumentType[] {
  return requiredDocuments(cause).filter((t) => !present.includes(t))
}

/** What the bucket accepts (storage.buckets.allowed_mime_types, 0035). The
 * server re-checks both; this is only so the file picker does not offer files
 * the upload will reject. */
export const ACCEPTED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export const CLAIM_DOCUMENTS_BUCKET = 'claim-documents'

/** The one path shape the storage policies recognise: claims/<claim_id>/<file>.
 * Anything else resolves to no claim and is therefore readable by nobody. */
export function claimDocumentPath(claimId: string, filename: string): string {
  // Spaces included: a storage key with spaces is legal but survives badly
  // through signed URLs and download headers.
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 120)
  return `claims/${claimId}/${crypto.randomUUID()}-${safe}`
}

export function documentRejection(
  file: { size: number; type: string; name: string },
): 'tooLarge' | 'empty' | 'type' | null {
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_DOCUMENT_BYTES) return 'tooLarge'
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) return 'type'
  if (!/\.(pdf|jpe?g|png|tiff?|webp|docx?|xlsx?|csv|txt)$/i.test(file.name)) return 'type'
  return null
}
