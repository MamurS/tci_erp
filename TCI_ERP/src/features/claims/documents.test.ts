import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0035_claim_documents.sql?raw'
import {
  ACCEPTED_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  REQUIRED_DOCUMENTS,
  claimDocumentPath,
  documentRejection,
  missingDocuments,
} from './documents'
import { CLAIM_DOCUMENT_TYPES } from './types'

describe('claim documents — contract with 0035', () => {
  it('lists exactly the document types the SQL enum declares', () => {
    const start = MIGRATION.indexOf('create type tci.claim_document_type as enum (')
    const block = MIGRATION.slice(start, MIGRATION.indexOf(');', start))
    for (const type of CLAIM_DOCUMENT_TYPES) {
      expect(block).toContain(`'${type}'`)
    }
  })

  it('mirrors the checklist per cause of loss', () => {
    expect(MIGRATION).toContain(
      "array['invoice', 'shipping', 'dunning']::tci.claim_document_type[]",
    )
    expect(MIGRATION).toContain(
      "array['invoice', 'shipping', 'insolvency_evidence']::tci.claim_document_type[]",
    )
    expect(REQUIRED_DOCUMENTS.protracted_default).toEqual(['invoice', 'shipping', 'dunning'])
    expect(REQUIRED_DOCUMENTS.insolvency).toEqual(['invoice', 'shipping', 'insolvency_evidence'])
    expect(REQUIRED_DOCUMENTS.other).toEqual(['invoice'])
  })

  it('does not ask an insolvency for a dunning trail', () => {
    expect(MIGRATION).toContain('raise exception \'insolvency must not require a dunning trail\'')
    expect(REQUIRED_DOCUMENTS.insolvency).not.toContain('dunning')
  })

  it('names what is missing rather than refusing in the abstract', () => {
    expect(MIGRATION).toContain(
      "v_blockers := v_blockers || ('claims.blocker.missingDocument.' || v_type::text)::text;",
    )
    expect(missingDocuments('protracted_default', ['invoice'])).toEqual(['shipping', 'dunning'])
    expect(missingDocuments('other', ['invoice'])).toEqual([])
  })

  it('mirrors the bucket size cap and MIME allowlist', () => {
    expect(MIGRATION).toContain('20971520,  -- 20 MiB')
    expect(MAX_DOCUMENT_BYTES).toBe(20971520)
    for (const mime of ACCEPTED_MIME_TYPES) {
      expect(MIGRATION, `${mime} not in the bucket allowlist`).toContain(`'${mime}'`)
    }
  })

  it('builds only paths the storage policies recognise', () => {
    expect(MIGRATION).toContain(
      "when p_path ~ '^claims/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'",
    )
    const path = claimDocumentPath('11111111-2222-3333-4444-555555555555', 'CMR 12/2025.pdf')
    expect(path).toMatch(
      /^claims\/11111111-2222-3333-4444-555555555555\/[0-9a-f-]{36}-CMR_12_2025\.pdf$/,
    )
  })

  it('refuses a file the upload would refuse anyway', () => {
    expect(documentRejection({ size: 0, type: 'application/pdf', name: 'a.pdf' })).toBe('empty')
    expect(
      documentRejection({ size: MAX_DOCUMENT_BYTES + 1, type: 'application/pdf', name: 'a.pdf' }),
    ).toBe('tooLarge')
    expect(documentRejection({ size: 10, type: 'application/x-msdownload', name: 'a.exe' })).toBe(
      'type',
    )
    // A declared type is not evidence: the extension has to agree too.
    expect(documentRejection({ size: 10, type: 'application/pdf', name: 'a.exe' })).toBe('type')
    expect(documentRejection({ size: 10, type: 'application/pdf', name: 'a.pdf' })).toBeNull()
  })
})
