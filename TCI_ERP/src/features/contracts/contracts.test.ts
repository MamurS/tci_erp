/** The pure contract-draft modules, and the mirrors of migration 0057. */
import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0057_contract_drafts.sql?raw'
import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'
import { NO_CONTRACT_STATUSES } from '../wording/contracts'
import { diffDocs, diffSummary, diffWords, docLines } from './diff'
import { CONTRACT_REFUSALS, contractErrorKey } from './errors'
import {
  AGREE_ROLES,
  canTransition,
  CLIENT_COMMENT_STATUS,
  CONTRACT_STATUSES,
  EDITABLE_STATUSES,
  hasManualEdits,
  isEditable,
  SHAREABLE_STATUSES,
  statusActions,
  TRANSITIONS,
  VERSION_SOURCES,
  WRITER_ROLES,
} from './machine'
import { collectFields, contextValue, refreshFields, scheduleCountChanged, skeleton, staleFields } from './mergeFields'
import type { BlockNode, ContractDoc } from './model'
import { numberLabels } from './numbering'
import { docNumbering } from './numbering'
import { clearWorkingCopy, readWorkingCopy, workingCopyKey, writeWorkingCopy } from './workingCopy'

const section = (text: string): BlockNode => ({
  type: 'heading',
  attrs: { level: 2, numbered: true },
  content: [{ type: 'text', text }],
})
const clause = (text: string, field?: { path: string; index?: number | null; value: string }): BlockNode => ({
  type: 'paragraph',
  attrs: { clause: true },
  content: [
    { type: 'text', text },
    ...(field ? [{ type: 'mergeField' as const, attrs: { path: field.path, index: field.index ?? null, value: field.value } }] : []),
  ],
})
const para = (text: string): BlockNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const docOf = (...content: BlockNode[]): ContractDoc => ({ type: 'doc', content })

describe('clause numbering is derived', () => {
  it('numbers sections and clauses, restarting clauses per section', () => {
    expect(numberLabels(['section', 'clause', 'clause', 'other', 'section', 'clause'])).toEqual([
      '1.', '1.1.', '1.2.', null, '2.', '2.1.',
    ])
  })

  it('a clause before any section is numbered on its own', () => {
    expect(numberLabels(['clause', 'clause', 'section', 'clause'])).toEqual(['1.', '2.', '1.', '1.1.'])
  })

  it('stays correct after inserting and removing clauses', () => {
    const before = docOf(section('A'), clause('a1'), clause('a2'), section('B'), clause('b1'))
    const inserted = docOf(section('A'), clause('a1'), clause('new'), clause('a2'), section('B'), clause('b1'))
    const removed = docOf(section('A'), clause('a2'), section('B'), clause('b1'))
    expect(docNumbering(before)).toEqual(['1.', '1.1.', '1.2.', '2.', '2.1.'])
    expect(docNumbering(inserted)).toEqual(['1.', '1.1.', '1.2.', '1.3.', '2.', '2.1.'])
    expect(docNumbering(removed)).toEqual(['1.', '1.1.', '2.', '2.1.'])
  })
})

describe('comparison', () => {
  it('finds the changed word and leaves the rest equal', () => {
    expect(diffWords('The insurer covers losses', 'The insurer shall cover losses')).toEqual([
      { op: 'equal', text: 'The insurer ' },
      { op: 'delete', text: 'covers' },
      { op: 'insert', text: 'shall cover' },
      { op: 'equal', text: ' losses' },
    ])
  })

  it('pairs a replaced line as changed and reports insertions and deletions', () => {
    const a = docOf(section('Scope'), clause('Old wording'), clause('Gone'), para('Same'))
    const b = docOf(section('Scope'), clause('New wording'), para('Same'), para('Added'))
    const lines = diffDocs(a, b)
    expect(lines.map((l) => l.op)).toEqual(['equal', 'change', 'delete', 'equal', 'insert'])
    expect(diffSummary(lines)).toEqual({ inserted: 1, deleted: 1, changed: 1 })
  })

  it('a renumbering alone is not a change', () => {
    const a = docOf(section('A'), clause('one'), clause('two'))
    const b = docOf(section('A'), clause('zero'), clause('one'), clause('two'))
    const lines = diffDocs(a, b)
    expect(diffSummary(lines)).toEqual({ inserted: 1, deleted: 0, changed: 0 })
    expect(lines.find((l) => l.after?.text === 'two')?.after?.label).toBe('1.3.')
    expect(lines.find((l) => l.after?.text === 'two')?.before?.label).toBe('1.2.')
  })

  it('reads table rows, list items and page breaks as lines', () => {
    const d: ContractDoc = docOf(
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('item')] }] },
      { type: 'pageBreak' },
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('a')] }, { type: 'tableCell', content: [para('b')] }] }],
      },
    )
    expect(docLines(d).map((l) => [l.kind, l.text])).toEqual([
      ['item', 'item'],
      ['pageBreak', '⸻'],
      ['row', 'a | b'],
    ])
  })
})

describe('merge fields', () => {
  const ctx = { policy: { number: 'P-2', currency: 'USD' }, limits: [{ amount: '1 000,00' }] }
  const d = docOf(
    clause('Policy ', { path: 'policy.number', value: 'P-1' }),
    clause('Currency ', { path: 'policy.currency', value: 'USD' }),
    clause('Limit ', { path: 'limits.amount', index: 0, value: '900,00' }),
  )

  it('reads a value by path and row', () => {
    expect(contextValue(ctx, 'policy.number', null)).toBe('P-2')
    expect(contextValue(ctx, 'limits.amount', 0)).toBe('1 000,00')
    expect(contextValue(ctx, 'limits.amount', 3)).toBeUndefined()
  })

  it('flags the fields whose source changed', () => {
    expect(staleFields(d, ctx).map((f) => [f.path, f.value, f.current])).toEqual([
      ['policy.number', 'P-1', 'P-2'],
      ['limits.amount', '900,00', '1 000,00'],
    ])
  })

  it('a refresh changes field values only — the skeleton the database compares is unchanged', () => {
    const { doc: next, changed } = refreshFields(d, ctx)
    expect(changed).toBe(2)
    expect(staleFields(next, ctx)).toEqual([])
    expect(skeleton(next)).toEqual(skeleton(d))
    expect(collectFields(next).map((f) => f.value)).toEqual(['P-2', 'USD', '1 000,00'])
  })

  it('notices a schedule with a different number of rows', () => {
    expect(scheduleCountChanged(d, ctx)).toBe(false)
    expect(scheduleCountChanged(d, { ...ctx, limits: [{}, {}] })).toBe(true)
  })
})

describe('the status machine mirrors 0057', () => {
  it('has the statuses and sources of the enums', () => {
    expect(MIGRATION).toContain(
      `create type tci.contract_draft_status as enum (${CONTRACT_STATUSES.map((s) => `'${s}'`).join(', ')});`,
    )
    expect(MIGRATION).toContain(
      `create type tci.contract_version_source as enum (${VERSION_SOURCES.map((s) => `'${s}'`).join(', ')});`,
    )
  })

  it('has exactly the five edges', () => {
    const body = MIGRATION.slice(MIGRATION.indexOf('create function tci.contract_transition_allowed'))
    const edges = body.slice(0, body.indexOf('$$\n;') === -1 ? body.indexOf("'agreed>signed')") + 20 : undefined)
    for (const edge of TRANSITIONS) expect(edges).toContain(`'${edge}'`)
    expect(TRANSITIONS).toHaveLength(5)
    expect(canTransition('agreed', 'signed')).toBe(true)
    expect(canTransition('signed', 'draft')).toBe(false)
    expect(canTransition('draft', 'agreed')).toBe(false)
  })

  it('edits only in draft and under review', () => {
    expect(MIGRATION).toContain(`select p_status in (${EDITABLE_STATUSES.map((s) => `'${s}'`).join(', ')})`)
    expect(isEditable('agreed')).toBe(false)
    expect(isEditable('signed')).toBe(false)
  })

  it('gates the writers, agreeing, sharing and client comments as the migration does', () => {
    // The role gates as 0065 restated them (admin is a technical role).
    expect(M65).toContain(`perform tci.require_role(${WRITER_ROLES.map((r) => `'${r}'`).join(', ')});`)
    expect(M65).toContain(
      `if (v_to = 'agreed' or v_from = 'agreed') and not tci.has_role(${AGREE_ROLES.map((r) => `'${r}'`).join(', ')}) then`,
    )
    expect(MIGRATION).toContain(
      `if coalesce(p_share, false) and v_draft.status not in (${SHAREABLE_STATUSES.map((s) => `'${s}'`).join(', ')}) then`,
    )
    expect(MIGRATION).toContain(`if v_draft.status <> '${CLIENT_COMMENT_STATUS}' then`)
    expect(MIGRATION).toContain("if v_from = 'agreed' and v_to = 'draft' and v_comment is null then")
  })

  it('offers each role only what the database will accept', () => {
    expect(statusActions('draft', ['sales']).map((a) => a.action)).toEqual(['submitForReview'])
    expect(statusActions('under_review', ['sales']).map((a) => a.action)).toEqual(['returnToDraft'])
    expect(statusActions('under_review', ['commercial_underwriter']).map((a) => a.action)).toEqual(['agree', 'returnToDraft'])
    expect(statusActions('agreed', ['sales']).map((a) => a.action)).toEqual(['sign'])
    expect(statusActions('agreed', ['commercial_underwriter']).find((a) => a.action === 'reopen')?.needsReason).toBe(true)
    expect(statusActions('signed', ['commercial_underwriter'])).toEqual([])
    for (const status of CONTRACT_STATUSES) expect(statusActions(status, ['admin'])).toEqual([])
    expect(statusActions('draft', ['credit_underwriter'])).toEqual([])
    for (const status of CONTRACT_STATUSES) {
      for (const a of statusActions(status, ['commercial_underwriter'])) expect(canTransition(status, a.to)).toBe(true)
    }
  })

  it('detects manual edits since the last generation exactly as tci.contract_has_manual_edits', () => {
    expect(MIGRATION).toContain("and v.source in ('manual', 'restored')")
    expect(MIGRATION).toContain("where g.draft_id = p_draft_id and g.source = 'generated'")
    expect(hasManualEdits([{ version_no: 1, source: 'generated' }])).toBe(false)
    expect(hasManualEdits([{ version_no: 1, source: 'generated' }, { version_no: 2, source: 'refreshed' }])).toBe(false)
    expect(hasManualEdits([{ version_no: 1, source: 'generated' }, { version_no: 2, source: 'manual' }])).toBe(true)
    expect(
      hasManualEdits([
        { version_no: 1, source: 'generated' },
        { version_no: 2, source: 'manual' },
        { version_no: 3, source: 'generated' },
      ]),
    ).toBe(false)
    expect(hasManualEdits([{ version_no: 1, source: 'generated' }, { version_no: 2, source: 'restored' }])).toBe(true)
  })

  it('refuses a draft for the same submissions the contracts page hides', () => {
    expect(MIGRATION).toContain(`if v_status in (${NO_CONTRACT_STATUSES.map((s) => `'${s}'`).join(', ')}) then`)
  })

  it('keeps a refresh to field values (the skeleton strips attrs.value of mergeField)', () => {
    expect(MIGRATION).toContain("if p ->> 'type' = 'mergeField' then")
    expect(MIGRATION).toContain("return p #- '{attrs,value}';")
  })
})

describe('refusals are mapped, never shown raw', () => {
  it.each(CONTRACT_REFUSALS)('$fragment exists in 0057', ({ fragment }) => {
    expect(MIGRATION).toContain(fragment)
  })

  it('maps by fragment and falls back by SQLSTATE', () => {
    expect(contractErrorKey({ message: 'contract_version_conflict: version 3 was saved' })).toBe('contractDrafts.errors.conflict')
    expect(contractErrorKey({ message: 'whatever', code: '42501' })).toBe('common.notPermitted')
  })

  it('never uses P0004', () => {
    expect(MIGRATION).not.toMatch(/errcode\s*=\s*'P0004'/i)
  })
})

describe('the local working copy', () => {
  const store = (() => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  })()

  it('round-trips per draft and person, and survives a broken store', () => {
    const key = workingCopyKey('d1', 'u1')
    expect(key).toBe('tci-contract-wc:d1:u1')
    const copy = { baseVersionNo: 3, content: docOf(para('x')), savedAt: '2026-10-22T08:00:00Z' }
    expect(writeWorkingCopy(key, copy, store)).toBe(true)
    expect(readWorkingCopy(key, store)).toEqual(copy)
    clearWorkingCopy(key, store)
    expect(readWorkingCopy(key, store)).toBeNull()
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(readWorkingCopy(key, broken)).toBeNull()
    expect(writeWorkingCopy(key, copy, broken)).toBe(false)
    expect(() => clearWorkingCopy(key, broken)).not.toThrow()
  })

  it('ignores a stored value that is not a working copy', () => {
    store.setItem('k', '{"baseVersionNo":1,"content":{"type":"para"}}')
    expect(readWorkingCopy('k', store)).toBeNull()
  })
})
