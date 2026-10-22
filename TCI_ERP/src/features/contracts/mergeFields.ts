/**
 * Merge fields in a contract document (pure): find them, say which ones the
 * data has moved away from, and refresh them — touching the `value` of each
 * chip and nothing else, which is exactly what tci.save_contract_version
 * checks for a 'refreshed' version (tci.contract_skeleton, 0057).
 *
 * Values are compared as PRINTED: the context comes from
 * wording/context.ts in the document's language, the same function that
 * printed the value in the first place.
 */

import type { ContractDoc, MergeFieldNode } from './model'

export interface FieldRef {
  path: string
  index: number | null
  value: string
}

/** The printed value of a field in a context, or undefined when the context
 * no longer has it (a limits row that is gone). */
export function contextValue(context: Record<string, unknown>, path: string, index: number | null): string | undefined {
  let base: unknown = context
  let rest = path
  if (index !== null) {
    const [list, ...field] = path.split('.')
    const rows = (context as Record<string, unknown>)[list!]
    if (!Array.isArray(rows) || index >= rows.length) return undefined
    base = rows[index]
    rest = field.join('.')
  }
  let v: unknown = base
  for (const key of rest.split('.')) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[key]
  }
  if (v === undefined) return undefined
  return v === null ? '' : typeof v === 'object' ? undefined : String(v)
}

type Json = unknown

function isField(node: Json): node is MergeFieldNode {
  return typeof node === 'object' && node !== null && (node as { type?: unknown }).type === 'mergeField'
}

function walk(node: Json, visit: (field: MergeFieldNode) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit))
  else if (typeof node === 'object' && node !== null) {
    if (isField(node)) visit(node)
    const content = (node as { content?: unknown }).content
    if (content) walk(content, visit)
  }
}

export function collectFields(doc: ContractDoc): FieldRef[] {
  const out: FieldRef[] = []
  walk(doc, (f) => out.push({ path: f.attrs.path, index: f.attrs.index ?? null, value: f.attrs.value ?? '' }))
  return out
}

export interface StaleField extends FieldRef {
  current: string
}

/** Fields whose source value is no longer what the document prints. */
export function staleFields(doc: ContractDoc, context: Record<string, unknown>): StaleField[] {
  return collectFields(doc).flatMap((f) => {
    const current = contextValue(context, f.path, f.index)
    return current !== undefined && current !== f.value ? [{ ...f, current }] : []
  })
}

/** The key the viewer and the editor flag a stale chip by. */
export function fieldKey(f: { path: string; index: number | null }): string {
  return f.index === null ? f.path : `${f.path}#${f.index}`
}

/** True when a repeated schedule in the document (the limits table) has a
 * different number of rows than the data has now — a refresh cannot add or
 * remove rows; generating again from the template can. */
export function scheduleCountChanged(doc: ContractDoc, context: Record<string, unknown>): boolean {
  const counts = new Map<string, number>()
  for (const f of collectFields(doc)) {
    if (f.index === null) continue
    const list = f.path.split('.')[0]!
    counts.set(list, Math.max(counts.get(list) ?? 0, f.index + 1))
  }
  for (const [list, n] of counts) {
    const rows = context[list]
    if (Array.isArray(rows) && rows.length !== n) return true
  }
  return false
}

function mapFields(node: Json, fn: (f: MergeFieldNode) => MergeFieldNode): Json {
  if (Array.isArray(node)) return node.map((n) => mapFields(n, fn))
  if (typeof node !== 'object' || node === null) return node
  if (isField(node)) return fn(node)
  const content = (node as { content?: unknown }).content
  return content === undefined ? node : { ...node, content: mapFields(content, fn) }
}

/** Every field set to its current value; the words around them untouched. */
export function refreshFields(
  doc: ContractDoc,
  context: Record<string, unknown>,
): { doc: ContractDoc; changed: number } {
  let changed = 0
  const next = mapFields(doc, (f) => {
    const current = contextValue(context, f.attrs.path, f.attrs.index ?? null)
    if (current === undefined || current === f.attrs.value) return f
    changed++
    return { ...f, attrs: { ...f.attrs, value: current } }
  }) as ContractDoc
  return { doc: next, changed }
}

/** The document with every field VALUE removed — the client-side twin of
 * tci.contract_skeleton, used to tell a field refresh from an edit. */
export function skeleton(doc: ContractDoc): Json {
  return mapFields(doc, (f) => {
    const attrs: Record<string, unknown> = { ...f.attrs }
    delete attrs.value
    return { ...f, attrs } as unknown as MergeFieldNode
  })
}
