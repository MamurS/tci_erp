/** The browser's mirrors of migration 0058 — the media library's limits, the
 * brochure's statuses and languages, and the refusals the screens map — read
 * against the migration TEXT, so the two sides cannot drift. */

import { describe, expect, it } from 'vitest'

import M58 from '../../../supabase/migrations/0058_commercial_offers.sql?raw'
import { OPERATIONS_REFUSALS } from '../../lib/refusals'
import { BROCHURE_STATUSES } from './editor'
import { brochureErrorKey } from './errors'
import {
  MEDIA_MAX_BYTES,
  MEDIA_MIME_TYPES,
  MEDIA_PATH_PATTERN,
  fileProblem,
  mediaStoragePath,
} from './media'
import { BROCHURE_LANGS, MEDIA_BUCKET } from './model'

describe('media library — contract with 0058', () => {
  it('accepts exactly the bucket’s types and size', () => {
    const quoted = MEDIA_MIME_TYPES.map((m) => `'${m}'`).join(', ')
    expect(M58).toContain(
      `values ('${MEDIA_BUCKET}', '${MEDIA_BUCKET}', false, ${MEDIA_MAX_BYTES}, array[${quoted}])`,
    )
    expect(M58).toContain(`mime_type     text not null check (mime_type in (${quoted}))`)
    expect(MEDIA_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  it('names a stored file as the storage policy and the table check require', () => {
    expect(M58).toContain(`storage_path ~* '${MEDIA_PATH_PATTERN.source}'`)
    expect(M58).toContain(`and name ~* '${MEDIA_PATH_PATTERN.source}'`)
    expect(MEDIA_PATH_PATTERN.flags).toContain('i')
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    for (const mime of MEDIA_MIME_TYPES)
      expect(mediaStoragePath(id, mime)).toMatch(MEDIA_PATH_PATTERN)
  })

  it('checks a file the way the bucket will', () => {
    expect(fileProblem({ type: 'image/png', size: MEDIA_MAX_BYTES })).toBeNull()
    expect(fileProblem({ type: 'image/png', size: MEDIA_MAX_BYTES + 1 })).toBe(
      'media.errors.fileTooLarge',
    )
    expect(fileProblem({ type: 'image/gif', size: 10 })).toBe('media.errors.fileType')
    expect(fileProblem({ type: 'image/svg+xml', size: 10 })).toBe('media.errors.fileType')
    expect(fileProblem({ type: 'image/jpeg', size: 0 })).toBe('media.errors.fileEmpty')
  })

  it('requires alt text in exactly the brochure’s languages', () => {
    for (const lang of BROCHURE_LANGS)
      expect(M58).toContain(`coalesce(btrim(alt ->> '${lang}'), '') <> ''`)
    expect(M58).toContain(
      '{ sections: [ { key, title: {en,ru,uz}, body: {en,ru,uz}, image_asset_id? } ] }',
    )
    expect([...BROCHURE_LANGS].sort()).toEqual(['en', 'ru', 'uz'])
  })
})

describe('brochure versions — contract with 0058', () => {
  it('knows the statuses of tci.brochure_status, in order', () => {
    const quoted = BROCHURE_STATUSES.map((s) => `'${s}'`).join(', ')
    expect(M58).toContain(`create type tci.brochure_status as enum (${quoted});`)
  })

  it('maps every brochure and media refusal the migration raises', () => {
    for (const code of [
      'brochure_content_invalid',
      'brochure_image_unknown',
      'brochure_not_draft',
      'media_not_uploaded',
    ]) {
      expect(M58).toMatch(new RegExp(`raise exception '${code}`))
      expect(
        OPERATIONS_REFUSALS.some((r) => r.fragment === code),
        code,
      ).toBe(true)
    }
    expect(
      brochureErrorKey({
        message: 'brochure_image_unknown: a section names an image that is not in the library',
        code: 'P0001',
      }),
    ).toBe('brochure.errors.imageUnknown')
    expect(brochureErrorKey({ message: 'brochure_content_invalid', code: 'P0001' })).toBe(
      'brochure.errors.contentInvalid',
    )
  })

  it('reads a 23514 check violation by the constraint it names', () => {
    // Postgres names an inline column check <table>_<column>_check.
    for (const column of ['alt', 'source', 'licence', 'mime_type', 'storage_path'])
      expect(M58).toMatch(new RegExp(`\\n  ${column}\\s+(text|jsonb)[^\\n]*check`))
    const violation = (c: string) => ({
      code: '23514',
      message: `new row for relation "media_assets" violates check constraint "${c}"`,
    })
    expect(brochureErrorKey(violation('media_assets_alt_check'))).toBe('media.errors.altRequired')
    expect(brochureErrorKey(violation('media_assets_source_check'))).toBe(
      'media.errors.sourceRequired',
    )
    expect(brochureErrorKey(violation('media_assets_licence_check'))).toBe(
      'media.errors.licenceRequired',
    )
    expect(brochureErrorKey(violation('something_else_check'))).toBe('media.errors.checkFailed')
  })

  it('never shows raw text: permissions and the unknown fall back by SQLSTATE', () => {
    expect(brochureErrorKey({ code: '42501', message: 'permission denied' })).toBe(
      'common.notPermitted',
    )
    expect(brochureErrorKey({ message: 'The object exceeded the maximum allowed size' })).toBe(
      'media.errors.fileTooLarge',
    )
    expect(brochureErrorKey({ message: 'mime type image/gif is not supported' })).toBe(
      'media.errors.fileType',
    )
    expect(brochureErrorKey(new Error('socket hang up'))).toBe('common.somethingWentWrong')
  })
})
