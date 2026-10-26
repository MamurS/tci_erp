/**
 * Table preferences, remembered per person in this browser (Prompt 30,
 * phase 2): the row DENSITY of every table (compact ≈ 40 px, regular ≈ 48 px,
 * relaxed ≈ 56 px rows) and, per registry, the columns someone hid. A
 * preference, not a record: nothing goes to the server, every read is
 * guarded, and the screens render the defaults without it.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'

export const DENSITIES = ['compact', 'regular', 'relaxed'] as const
export type Density = (typeof DENSITIES)[number]

/** The row height of each density: a cell's height is its row's MINIMUM
 * height, so a row of one line is exactly 40 / 48 / 56 px and a wrapped cell
 * still grows. */
export const DENSITY_CELL: Record<Density, string> = {
  compact: '[&_td]:h-10 [&_td]:py-1 [&_th]:py-2',
  regular: '[&_td]:h-12 [&_td]:py-2 [&_th]:py-3',
  relaxed: '[&_td]:h-14 [&_td]:py-3 [&_th]:py-3',
}

const DENSITY_KEY = (user: string) => `tci-erp-density:${user}`
const COLUMNS_KEY = (user: string, table: string) => `tci-erp-columns:${user}:${table}`
const EVENT = 'tci-erp-table-prefs'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // A blocked or full storage keeps the default; nothing else depends on it.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function parseDensity(value: string | null, fallback: Density): Density {
  return (DENSITIES as readonly string[]).includes(value ?? '') ? (value as Density) : fallback
}

/** Who the preferences belong to and the default density of the surface
 * (staff screens regular, the client portal relaxed). */
export const TablePrefsContext = createContext<{ user: string; defaultDensity: Density }>({
  user: 'anonymous',
  defaultDensity: 'regular',
})

export function useDensity(): [Density, (next: Density) => void] {
  const { user, defaultDensity } = useContext(TablePrefsContext)
  const raw = useSyncExternalStore(
    subscribe,
    () => read(DENSITY_KEY(user)),
    () => null,
  )
  return [parseDensity(raw, defaultDensity), (next) => write(DENSITY_KEY(user), next)]
}

export function parseHidden(value: string | null): number[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => Number.isInteger(n) && n >= 0)
      : []
  } catch {
    return []
  }
}

/** The column indices hidden in one table (`id`), and the setter; `null`
 * resets to the default (every column). Without an id nothing is hidden. */
export function useHiddenColumns(
  id: string | undefined,
): [number[], (next: number[] | null) => void] {
  const { user } = useContext(TablePrefsContext)
  const raw = useSyncExternalStore(
    subscribe,
    () => (id ? read(COLUMNS_KEY(user, id)) : null),
    () => null,
  )
  return [
    parseHidden(raw),
    (next) => {
      if (id)
        write(
          COLUMNS_KEY(user, id),
          next && next.length ? JSON.stringify([...new Set(next)].sort((a, b) => a - b)) : null,
        )
    },
  ]
}

/** The CSS that hides the chosen columns of the table it is scoped to. */
export function hiddenColumnsCss(scope: string, hidden: readonly number[]): string {
  return hidden
    .map(
      (i) =>
        `[data-table="${scope}"] tr > :nth-child(${i + 1}), [data-table="${scope}"] col:nth-child(${i + 1}) { display: none; }`,
    )
    .join('\n')
}
