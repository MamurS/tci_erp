/** Downloads of a version: .docx built in the browser (the export chunk loads
 * on first use), PDF through the print route and the browser's own «Save as
 * PDF» — nothing leaves our infrastructure. */

import { saveBlob } from '../wording/api'
import { fetchVersion } from './api'
import { printPath } from './paths'

export function versionFileName(reference: string, draftNumber: string, versionNo: number, ext: 'docx' | 'pdf'): string {
  return `${reference} — ${draftNumber} v${versionNo}.${ext}`.replace(/[\\/:*?"<>|]+/g, '_')
}

export async function downloadVersionDocx(input: {
  draftId: string
  draftNumber: string
  reference: string
  versionNo: number
  language: string
}): Promise<void> {
  const [{ exportDocx }, version] = await Promise.all([import('./exportDocx'), fetchVersion(input.draftId, input.versionNo)])
  const name = versionFileName(input.reference, input.draftNumber, input.versionNo, 'docx')
  const blob = await exportDocx(version.content, { title: name.replace(/\.docx$/, ''), language: input.language })
  saveBlob(blob, name)
}

export function openVersionPdf(draftId: string, versionNo: number): void {
  window.open(printPath(draftId, versionNo), '_blank', 'noopener')
}
