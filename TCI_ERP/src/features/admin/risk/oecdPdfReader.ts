/**
 * The OECD PDF as text lines, for oecdPdf.ts. pdf.js runs in the browser —
 * the file never leaves it — and this module is loaded only when a PDF is
 * chosen, so the reader is a chunk of its own. Its worker is served from our
 * own origin (`worker-src 'self'` in public/_headers); pdf.js 6 uses no eval.
 *
 * Lines are rebuilt from the text items' positions: items on one baseline
 * (within a point) form a line, read left to right, with a space where the
 * gap between two items shows one.
 */

// The legacy build: the modern one needs JavaScript newer than many office
// browsers have (Math.sumPrecise), and warns or fails on them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Piece {
  x: number
  y: number
  width: number
  text: string
}

export async function readPdfLines(data: ArrayBuffer): Promise<string[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const lines: string[] = []
  try {
    const doc = await task.promise
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const pieces: Piece[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str === '') continue
        pieces.push({ x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, text: item.str })
      }
      // Top of the page first; one baseline per line.
      pieces.sort((a, b) => b.y - a.y || a.x - b.x)
      let row: Piece[] = []
      const flush = () => {
        if (row.length === 0) return
        row.sort((a, b) => a.x - b.x)
        let text = ''
        let end = -Infinity
        for (const piece of row) {
          if (text && piece.x - end > 0.5 && !text.endsWith(' ') && !piece.text.startsWith(' ')) text += ' '
          text += piece.text
          end = piece.x + piece.width
        }
        lines.push(text.replace(/\s+/g, ' ').trim())
        row = []
      }
      for (const piece of pieces) {
        if (row.length && Math.abs(row[0]!.y - piece.y) > 1) flush()
        row.push(piece)
      }
      flush()
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return lines
}
