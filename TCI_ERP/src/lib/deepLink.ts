/** Reading the context a deep link carries (the Agenda's «go to the task»
 * buttons, a link in a notification).
 *
 * A destination screen must render EXACTLY as it does without these
 * parameters, and a parameter it does not recognise — a stale id, a typo, a
 * view this person may not see — must fall back to that default rather than
 * to an empty or broken screen. Everything here is therefore total: an unknown
 * value reads as "no context", never as an error.
 */

/** The value of a parameter when it is one of `allowed`, else null. */
export function pickParam<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/** A comma-separated id list (`?instalments=a,b,c`): trimmed, empty entries
 * dropped, duplicates removed, order kept. */
export function parseIdList(value: string | null | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]
}

/** `rows` narrowed to `ids`. When the list is empty, or names none of the
 * rows (a stale link), nothing is narrowed: `filtered` is false and every row
 * comes back — a link that names nothing we hold must not empty the screen. */
export function narrowToIds<T extends { id: string }>(
  rows: readonly T[],
  ids: readonly string[],
): { rows: readonly T[]; filtered: boolean } {
  if (!ids.length) return { rows, filtered: false }
  const wanted = new Set(ids)
  const hit = rows.filter((row) => wanted.has(row.id))
  return hit.length ? { rows: hit, filtered: true } : { rows, filtered: false }
}

/** A calendar date in ISO form, `YYYY-MM-DD`, that actually exists. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
