import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  exactly,
  optimistic,
  patch,
  refusalOr,
  rowAt,
  rowInList,
  rowInLists,
  rowOutOfList,
  rowsOutOfLists,
  settleKeys,
} from './optimistic'

type Row = { id: string; status: string }

const rows: Row[] = [
  { id: 'a', status: 'draft' },
  { id: 'b', status: 'draft' },
]

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['things'], rows)
  qc.setQueryData(['things', 'a'], rows[0])
  return qc
}

describe('optimistic', () => {
  it('paints every patched key before the answer and restores them on a refusal', async () => {
    const qc = client()
    const refusals: string[] = []
    const handlers = optimistic<string, void>(qc, {
      patches: (id) => [
        rowInList<Row, string>(['things'], (v) => v, (row) => ({ ...row, status: 'done' })),
        rowAt<Row, string>(['things', id], (row) => ({ ...row, status: 'done' })),
      ],
      mapError: () => 'things.errors.refused',
      onRefusal: (key) => refusals.push(key),
    })
    const snapshot = await handlers.onMutate('a')
    expect(qc.getQueryData<Row[]>(['things'])?.[0].status).toBe('done')
    expect(qc.getQueryData<Row[]>(['things'])?.[1].status).toBe('draft')
    expect(qc.getQueryData<Row>(['things', 'a'])?.status).toBe('done')

    handlers.onError(new Error('no'), 'a', snapshot)
    expect(qc.getQueryData(['things'])).toEqual(rows)
    expect(qc.getQueryData(['things', 'a'])).toEqual(rows[0])
    expect(refusals).toEqual(['things.errors.refused'])
    await handlers.onSettled(undefined, new Error('no'), 'a', snapshot)
  })

  it('maps a refusal through refusalKey by default — never raw server text', async () => {
    const qc = client()
    const seen: string[] = []
    const handlers = optimistic<string, void>(qc, {
      patches: () => [],
      onRefusal: (key) => seen.push(key),
    })
    handlers.onError({ code: '42501', message: 'permission denied for table x' }, 'a', await handlers.onMutate('a'))
    expect(seen).toEqual(['common.notPermitted'])
  })

  it('leaves untouched a query that holds no data yet', async () => {
    const qc = client()
    const handlers = optimistic<string, void>(qc, {
      patches: () => [rowAt<Row, string>(['things', 'missing'], (row) => ({ ...row, status: 'done' }))],
    })
    const snapshot = await handlers.onMutate('a')
    expect(snapshot.entries).toEqual([])
    expect(qc.getQueryData(['things', 'missing'])).toBeUndefined()
    await handlers.onSettled(undefined, null, 'a', snapshot)
  })

  it('hands a prefix patch each concrete key', async () => {
    const qc = client()
    qc.setQueryData(['c', ['t1']], ['x'])
    qc.setQueryData(['c', ['t2']], ['y'])
    const handlers = optimistic<string, void>(qc, {
      patches: () => [
        patch<string[], string>(['c'], (old, v, key) => ((key[1] as string[]).includes('t1') ? [...old, v] : old)),
      ],
    })
    const snapshot = await handlers.onMutate('z')
    expect(qc.getQueryData(['c', ['t1']])).toEqual(['x', 'z'])
    expect(qc.getQueryData(['c', ['t2']])).toEqual(['y'])
    await handlers.onSettled(undefined, null, 'z', snapshot)
  })

  it('writes the server answer and then skips refetching what it wrote', async () => {
    const qc = client()
    const handlers = optimistic<string, Row>(qc, {
      patches: () => [rowAt<Row, string>(['things', 'a'], (row) => ({ ...row, status: 'pending' }))],
      answer: (c, row) => c.setQueryData(['things', 'a'], row),
    })
    const snapshot = await handlers.onMutate('a')
    handlers.onSuccess({ id: 'a', status: 'stored' }, 'a')
    await handlers.onSettled({ id: 'a', status: 'stored' }, null, 'a', snapshot)
    const state = qc.getQueryState(['things', 'a'])
    expect(qc.getQueryData<Row>(['things', 'a'])?.status).toBe('stored')
    expect(state?.isInvalidated).toBe(false)
  })

  it('does not invalidate a key another optimistic write is still painting', async () => {
    const qc = client()
    const make = () =>
      optimistic<string, void>(qc, {
        patches: (id) => [rowInList<Row, string>(['things'], () => id, (row) => ({ ...row, status: 'done' }))],
      })
    const first = make()
    const second = make()
    const s1 = await first.onMutate('a')
    const s2 = await second.onMutate('b')
    await first.onSettled(undefined, null, 'a', s1)
    expect(qc.getQueryState(['things'])?.isInvalidated).toBe(false)
    expect(qc.getQueryData<Row[]>(['things'])?.map((r) => r.status)).toEqual(['done', 'done'])
    await second.onSettled(undefined, null, 'b', s2)
    expect(qc.getQueryState(['things'])?.isInvalidated).toBe(true)
  })
})

describe('settleKeys', () => {
  it('invalidates painted keys as painted and extras as prefixes, without repeats', () => {
    const painted = [
      { key: ['things'], exact: true },
      { key: ['things', 'a'], exact: true },
    ]
    expect(settleKeys(painted, [['agenda', 'tasks']], false)).toEqual([
      { key: ['things'], exact: true },
      { key: ['things', 'a'], exact: true },
      { key: ['agenda', 'tasks'], exact: false },
    ])
  })

  it('drops what a broader prefix already covers', () => {
    const painted = [{ key: ['things', 'a'], exact: true }]
    expect(settleKeys(painted, [['things'], ['things'], ['things', 'b']], false)).toEqual([
      { key: ['things'], exact: false },
    ])
  })

  it('skips painted keys the answer wrote, but keeps exact extras exact', () => {
    const painted = [{ key: ['things'], exact: true }]
    expect(settleKeys(painted, [exactly(['other'])], true)).toEqual([{ key: ['other'], exact: true }])
  })
})

describe('row patch builders', () => {
  const apply = <V,>(p: ReturnType<typeof rowInList<Row, V>>, old: unknown, v: V) => p.apply(old, v, p.key)

  it('rowInList changes only the named row and passes non-lists through', () => {
    const p = rowInList<Row, string>(['things'], (v) => v, (row) => ({ ...row, status: 'x' }))
    expect(apply(p, rows, 'b')).toEqual([rows[0], { id: 'b', status: 'x' }])
    expect(apply(p, null, 'b')).toBeNull()
    expect(p.exact).toBe(true)
  })

  it('rowInLists is a prefix patch with a custom match', () => {
    const p = rowInLists<{ decision_id: string; held: boolean }, string>(
      ['eff'],
      (v) => v,
      (row) => ({ ...row, held: true }),
      (row) => row.decision_id,
    )
    expect(p.exact).toBeFalsy()
    expect(p.apply([{ decision_id: 'd', held: false }], 'd', ['eff', 'x'])).toEqual([{ decision_id: 'd', held: true }])
  })

  it('rowAt leaves a missing row missing', () => {
    const p = rowAt<Row, string>(['things', 'a'], (row) => ({ ...row, status: 'x' }))
    expect(p.apply(null, 'a', p.key)).toBeNull()
    expect(p.apply(rows[0], 'a', p.key)).toEqual({ id: 'a', status: 'x' })
  })

  it('rowOutOfList and rowsOutOfLists remove by id', () => {
    expect(rowOutOfList<Row, string>(['things'], (v) => v).apply(rows, 'a', ['things'])).toEqual([rows[1]])
    expect(rowsOutOfLists<Row, string>(['things'], (v) => v).apply(rows, 'b', ['things', 1])).toEqual([rows[0]])
  })
})

describe('refusalOr', () => {
  it('names a recognised refusal and falls back to the action, never to "something went wrong"', () => {
    expect(refusalOr({ code: '42501' }, 'common.saveFailed')).toBe('common.notPermitted')
    expect(refusalOr(new Error('socket hang up'), 'common.saveFailed')).toBe('common.saveFailed')
    expect(refusalOr(new Error('x'), 'fallback', () => null)).toBe('fallback')
  })
})
