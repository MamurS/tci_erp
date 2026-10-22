/**
 * The views of «Управление данными» (?view=): the request queue, the data
 * freshness list, and the buyers clients proposed from the portal. The whole
 * section belongs to information managers and admins (navigation.ts).
 */

export const DATA_VIEWS = ['queue', 'freshness', 'proposals'] as const
export type DataView = (typeof DATA_VIEWS)[number]

/** An unknown view falls back to the queue. */
export function parseDataView(value: string | null | undefined): DataView {
  return (DATA_VIEWS as readonly string[]).includes(value ?? '') ? (value as DataView) : 'queue'
}
