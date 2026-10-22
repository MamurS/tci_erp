/**
 * Readable messages for what the brochure and the media library refuse
 * (migration 0058). The deliberate refusals of the writer functions are
 * shared fragments in lib/refusals.ts (contract-tested there); this adds the
 * three things that are not a `raise exception`:
 *
 *   * a CHECK violation (23514) on tci.media_assets — which constraint names
 *     what is missing (an alt language, the source, the licence);
 *   * the Storage bucket's own refusals (type, size, a name already taken);
 *   * the browser's own checks before anything is sent (MediaFileError).
 */

import { refusalKey } from '../../lib/refusals'

/** A refusal decided in the browser; `key` is the i18n key. */
export class MediaFileError extends Error {
  constructor(public readonly key: string) {
    super(key)
    this.name = 'MediaFileError'
  }
}

/** Constraint name fragment → what the person has to fix. */
const CHECKS: readonly { constraint: string; key: string }[] = [
  { constraint: 'media_assets_alt_check', key: 'media.errors.altRequired' },
  { constraint: 'media_assets_source_check', key: 'media.errors.sourceRequired' },
  { constraint: 'media_assets_licence_check', key: 'media.errors.licenceRequired' },
  { constraint: 'media_assets_mime_type_check', key: 'media.errors.fileType' },
  { constraint: 'media_assets_storage_path_check', key: 'media.errors.fileType' },
  { constraint: 'brochure_versions_content_check', key: 'brochure.errors.contentInvalid' },
]

export function brochureErrorKey(error: unknown): string {
  if (error instanceof MediaFileError) return error.key
  const e = error as {
    message?: unknown
    code?: unknown
    details?: unknown
    statusCode?: unknown
  } | null
  const message = typeof e?.message === 'string' ? e.message : ''
  const details = typeof e?.details === 'string' ? e.details : ''
  if (e?.code === '23514') {
    const hit = CHECKS.find((c) => message.includes(c.constraint) || details.includes(c.constraint))
    return hit?.key ?? 'media.errors.checkFailed'
  }
  // Storage refusals carry no SQLSTATE; their wording is the API's.
  if (/mime type|invalid_mime|not supported/i.test(message)) return 'media.errors.fileType'
  if (/maximum allowed size|payload too large|entity too large/i.test(message))
    return 'media.errors.fileTooLarge'
  if (/already exists|duplicate/i.test(message)) return 'media.errors.uploadConflict'
  if (/row-level security|unauthorized/i.test(message) && e?.code === undefined)
    return 'common.notPermitted'
  return refusalKey(error)
}
