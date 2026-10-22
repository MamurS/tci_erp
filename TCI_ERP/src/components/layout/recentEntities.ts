/**
 * The companies a person opened last, shown by the command palette before
 * anything is typed. A per-browser convenience (localStorage): it may come
 * back empty or be unavailable (private window, blocked storage), and the
 * palette works the same without it.
 */

export interface RecentEntity {
  id: string
  name: string
  /** Registration number and country, as the palette's second line. */
  sub?: string
}

const KEY = 'tci-erp-recent-entities'
export const RECENT_LIMIT = 5

/** The list with `entry` moved to the front, without duplicates, capped. */
export function withRecent(list: readonly RecentEntity[], entry: RecentEntity): RecentEntity[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, RECENT_LIMIT)
}

function isRecent(value: unknown): value is RecentEntity {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.name === 'string' && (v.sub === undefined || typeof v.sub === 'string')
}

/** Parses what storage held; anything malformed is dropped, never thrown. */
export function parseRecent(raw: string | null): RecentEntity[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function readRecentEntities(): RecentEntity[] {
  try {
    return parseRecent(window.localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export function rememberEntity(entry: RecentEntity): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(withRecent(readRecentEntities(), entry)))
  } catch {
    // Storage unavailable: the palette simply shows no recent companies.
  }
}
