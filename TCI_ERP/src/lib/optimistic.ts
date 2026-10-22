/** Optimistic updates, one way for every mutation that changes a visible row.
 *
 * The click paints at once: `onMutate` cancels what is in flight for the
 * touched keys, snapshots them and writes the change the server is certain to
 * make. A refusal restores the snapshot and reports the MAPPED message (the
 * feature's own error map, `refusalKey` by default) — never raw server text.
 * Once settled, only the touched keys (and any the caller names) are
 * invalidated; when the RPC answers with the updated rows, `answer` writes
 * them straight into the cache instead, so nothing is refetched to show them.
 *
 * Optimism is only for what is CERTAIN. A decision the server makes on its
 * own (an escalation, an approval amount) is never painted ahead of the
 * answer: those mutations get an in-place pending state, not a patch.
 *
 * `apply` functions are pure — `(old, vars) => new` — and live in testable
 * modules next to their feature; this file never knows a row's shape. */

import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { refusalKey } from './refusals'

/** One cache entry — or every entry under a key prefix — and how it changes. */
export interface Patch<TVars> {
  key: QueryKey
  /** `true`: only that exact key. Default: every query under the prefix. */
  exact?: boolean
  /** The new data; `key` is the concrete key, for a prefix patch. */
  apply: (old: unknown, vars: TVars, key: QueryKey) => unknown
}

/** A typed patch. `apply` only ever sees data that is present. */
export function patch<TData, TVars>(
  key: QueryKey,
  apply: (old: TData, vars: TVars, key: QueryKey) => TData,
  options: { exact?: boolean } = {},
): Patch<TVars> {
  return { key, exact: options.exact, apply: apply as (old: unknown, vars: TVars, key: QueryKey) => unknown }
}

export interface OptimisticOptions<TVars, TResult> {
  /** What to paint before the server answers. */
  patches: (vars: TVars) => readonly Patch<TVars>[]
  /** Write the RPC's answer (the updated rows) into the cache. */
  answer?: (qc: QueryClient, result: TResult, vars: TVars) => void
  /** Further keys the change affects, invalidated once settled — as
   * prefixes, or `exactly(key)`. The painted keys are invalidated too (as
   * painted), unless `answer` already wrote them. */
  invalidate?: (vars: TVars, result: TResult | undefined) => readonly (QueryKey | KeyTarget)[]
  /** The feature's own error map (an i18n key); `refusalKey` by default. */
  mapError?: (error: unknown) => string
  /** Called with the mapped key after the rollback. */
  onRefusal?: (messageKey: string, error: unknown) => void
}

/** What `onMutate` saved: the data to restore on a refusal, and the keys it
 * painted (to invalidate, or not, once settled). */
export interface Snapshot {
  entries: readonly (readonly [QueryKey, unknown])[]
  painted: readonly KeyTarget[]
}

/** A key to invalidate: exactly, or as a prefix. */
export interface KeyTarget {
  key: QueryKey
  exact: boolean
}

/** Optimistic writes still in flight per patched key (hashed). */
const inFlight = new Map<string, number>()

function hashKey(key: QueryKey): string {
  return JSON.stringify(key)
}

/** The four callbacks to spread into `useMutation`. */
export function optimistic<TVars, TResult = unknown>(qc: QueryClient, options: OptimisticOptions<TVars, TResult>) {
  const map = options.mapError ?? refusalKey
  return {
    onMutate: async (vars: TVars): Promise<Snapshot> => {
      const patches = options.patches(vars)
      const painted = patches.map((p) => ({ key: p.key, exact: Boolean(p.exact) }))
      for (const p of painted) inFlight.set(hashKey(p.key), (inFlight.get(hashKey(p.key)) ?? 0) + 1)
      await Promise.all(patches.map((p) => qc.cancelQueries({ queryKey: p.key, exact: p.exact })))
      const entries: (readonly [QueryKey, unknown])[] = []
      for (const p of patches) {
        for (const [key, data] of qc.getQueriesData({ queryKey: p.key, exact: p.exact })) {
          if (data === undefined) continue
          // A key two patches touch is snapshotted once, before the first.
          if (!entries.some(([k]) => sameKey(k, key))) entries.push([key, data] as const)
          qc.setQueryData(key, p.apply(qc.getQueryData(key), vars, key))
        }
      }
      return { entries, painted }
    },
    onError: (error: unknown, _vars: TVars, snapshot: Snapshot | undefined) => {
      for (const [key, data] of snapshot?.entries ?? []) qc.setQueryData(key, data)
      options.onRefusal?.(map(error), error)
    },
    onSuccess: (result: TResult, vars: TVars) => {
      options.answer?.(qc, result, vars)
    },
    onSettled: (result: TResult | undefined, error: unknown, vars: TVars, snapshot: Snapshot | undefined) => {
      // A key another optimistic write is still painting is left alone: a
      // refetch now would bring back the row that write just changed. The
      // last write on the key invalidates it.
      const settled = (snapshot?.painted ?? []).filter((p) => {
        const left = (inFlight.get(hashKey(p.key)) ?? 1) - 1
        if (left > 0) inFlight.set(hashKey(p.key), left)
        else inFlight.delete(hashKey(p.key))
        return left === 0
      })
      const targets = settleKeys(settled, options.invalidate?.(vars, result) ?? [], Boolean(options.answer) && !error)
      return Promise.all(targets.map((t) => qc.invalidateQueries({ queryKey: t.key, exact: t.exact }))).then(
        () => undefined,
      )
    },
  }
}

/** What to invalidate once a mutation settles: the extra keys (as prefixes)
 * always, the painted ones (as painted) unless the server's answer already
 * wrote them. A target another prefix in the list already covers is dropped. */
export function settleKeys(
  painted: readonly KeyTarget[],
  extra: readonly (QueryKey | KeyTarget)[],
  answered: boolean,
): KeyTarget[] {
  const all: KeyTarget[] = [
    ...(answered ? [] : painted),
    ...extra.map((x) => (isTarget(x) ? x : { key: x, exact: false })),
  ]
  return all.filter(
    (t, i) =>
      !all.some(
        (o, j) => j !== i && !o.exact && isPrefix(o.key, t.key) && (o.key.length < t.key.length || t.exact || j < i),
      ),
  )
}

/** Invalidate exactly this key, not everything under it. */
export function exactly(key: QueryKey): KeyTarget {
  return { key, exact: true }
}

function isTarget(x: QueryKey | KeyTarget): x is KeyTarget {
  return !Array.isArray(x)
}

function isPrefix(prefix: QueryKey, key: QueryKey): boolean {
  return prefix.length <= key.length && prefix.every((part, i) => hashKey([part]) === hashKey([key[i]]))
}

function sameKey(a: QueryKey, b: QueryKey): boolean {
  return a.length === b.length && isPrefix(a, b)
}

// ---------------------------------------------------------------------------
// Small pure helpers the `apply` functions keep reaching for
// ---------------------------------------------------------------------------

/** Replace the row with the given id by `change(row)`; others untouched. */
export function updateRow<T extends { id: string }>(rows: readonly T[], id: string, change: (row: T) => T): T[] {
  return rows.map((row) => (row.id === id ? change(row) : row))
}

/** Drop the rows with the given ids. */
export function removeRows<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const gone = new Set(ids)
  return rows.filter((row) => !gone.has(row.id))
}

/** Insert or replace a row by id (new rows go at the end). */
export function upsertRow<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]
}

/** A placeholder id for a row the server has not created yet. */
export function pendingId(): string {
  return `pending-${Math.random().toString(36).slice(2, 10)}`
}

export function isPendingId(id: string): boolean {
  return id.startsWith('pending-')
}

// ---------------------------------------------------------------------------
// Patch builders for the two shapes almost every screen caches
// ---------------------------------------------------------------------------

/** A list query (exact key): the row(s) `idOf(vars)` names change by `change`.
 * `match` defaults to `row.id`. */
export function rowInList<TRow, TVars>(
  key: QueryKey,
  idOf: (vars: TVars) => string,
  change: (row: TRow, vars: TVars) => TRow,
  match: (row: TRow) => string = (row) => (row as { id: string }).id,
): Patch<TVars> {
  return patch<TRow[] | null, TVars>(
    key,
    (rows, vars) => (Array.isArray(rows) ? rows.map((row) => (match(row) === idOf(vars) ? change(row, vars) : row)) : rows),
    { exact: true },
  )
}

/** Every list query under a key PREFIX (filtered variants of one list). */
export function rowInLists<TRow, TVars>(
  prefix: QueryKey,
  idOf: (vars: TVars) => string,
  change: (row: TRow, vars: TVars) => TRow,
  match: (row: TRow) => string = (row) => (row as { id: string }).id,
): Patch<TVars> {
  return patch<TRow[] | null, TVars>(prefix, (rows, vars) =>
    Array.isArray(rows) ? rows.map((row) => (match(row) === idOf(vars) ? change(row, vars) : row)) : rows,
  )
}

/** A detail query (exact key) holding one row, or null while it is missing. */
export function rowAt<TRow, TVars>(key: QueryKey, change: (row: TRow, vars: TVars) => TRow): Patch<TVars> {
  return patch<TRow | null, TVars>(key, (row, vars) => (row ? change(row, vars) : row), { exact: true })
}

/** A list query (exact key) loses the row(s) `idOf(vars)` names. */
export function rowOutOfList<TRow, TVars>(
  key: QueryKey,
  idOf: (vars: TVars) => string,
  match: (row: TRow) => string = (row) => (row as { id: string }).id,
): Patch<TVars> {
  return patch<TRow[] | null, TVars>(
    key,
    (rows, vars) => (Array.isArray(rows) ? rows.filter((row) => match(row) !== idOf(vars)) : rows),
    { exact: true },
  )
}

/** The mapped message key for a failed write: the map's own answer when it
 * recognises the refusal, else the screen's `fallback` (which names the
 * action) instead of the bare "something went wrong". */
export function refusalOr(
  error: unknown,
  fallback: string,
  map: (error: unknown) => string | null = refusalKey,
): string {
  const key = map(error)
  return key && key !== 'common.somethingWentWrong' ? key : fallback
}

/** Every list query under a key PREFIX loses the row(s) `idOf(vars)` names. */
export function rowsOutOfLists<TRow, TVars>(
  prefix: QueryKey,
  idOf: (vars: TVars) => string,
  match: (row: TRow) => string = (row) => (row as { id: string }).id,
): Patch<TVars> {
  return patch<TRow[] | null, TVars>(prefix, (rows, vars) =>
    Array.isArray(rows) ? rows.filter((row) => match(row) !== idOf(vars)) : rows,
  )
}
