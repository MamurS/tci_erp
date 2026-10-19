/** Readable messages for the wording refusals of migration 0050 (contract
 *  tested in errors.test.ts), falling back to the shared SQLSTATE mapping. */

import { refusalKey } from '../../lib/refusals'
import { WordingError } from './api'

export const WORDING_REFUSALS: readonly { fragment: string; key: string }[] = [
  { fragment: 'wording_unknown_placeholders', key: 'wording.errors.unknownPlaceholders' },
  { fragment: 'wording_template_retired', key: 'wording.errors.retired' },
  { fragment: 'wording_template_not_active', key: 'wording.errors.notActive' },
  { fragment: 'a wording template must be a .docx', key: 'wording.errors.notDocx' },
  { fragment: 'the uploaded template was not found in storage', key: 'wording.errors.uploadLost' },
  { fragment: 'the generated document was not found in storage', key: 'wording.errors.uploadLost' },
]

export function wordingErrorKey(error: unknown): string {
  if (error instanceof WordingError) return 'wording.errors.invalidTemplate'
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string') {
    const hit = WORDING_REFUSALS.find((r) => message.includes(r.fragment))
    if (hit) return hit.key
    if (/mime type|not supported|invalid_mime/i.test(message)) return 'wording.errors.notDocx'
    if (/exceeded the maximum allowed size|payload too large/i.test(message)) return 'wording.errors.tooLarge'
  }
  return refusalKey(error)
}
