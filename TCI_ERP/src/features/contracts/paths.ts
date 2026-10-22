/** Where the draft screens live (under «Полисы», whose route guard they
 * share) and what their query parameters mean. */

import type { ConversionWarning } from './fromDocx'

export const DRAFT_BASE = '/policies/contracts'

/** The viewer; `warnings` are what the last generation could not carry. */
export function draftPath(draftId: string, warnings: readonly ConversionWarning[] = []): string {
  return `${DRAFT_BASE}/${draftId}${warnings.length ? `?warnings=${warnings.join(',')}` : ''}`
}

export const versionPath = (draftId: string, versionNo: number) => `${DRAFT_BASE}/${draftId}?v=${versionNo}`
export const editPath = (draftId: string) => `${DRAFT_BASE}/${draftId}/edit`
export const comparePath = (draftId: string, older?: number, newer?: number) =>
  `${DRAFT_BASE}/${draftId}/compare${older && newer ? `?a=${older}&b=${newer}` : ''}`
export const printPath = (draftId: string, versionNo: number) => `${DRAFT_BASE}/${draftId}/print?v=${versionNo}&auto=1`

export const WARNINGS: readonly ConversionWarning[] = [
  'images',
  'textBoxes',
  'headerFooter',
  'unclosedSection',
  'unsupportedSection',
  'multiLevelList',
]

export function parseWarnings(raw: string | null): ConversionWarning[] {
  return (raw ?? '').split(',').filter((w): w is ConversionWarning => (WARNINGS as readonly string[]).includes(w))
}
