/**
 * Geometry of the «How it works» diagram (BrochureBody draws it as inline
 * SVG). Labels arrive in three languages of very different lengths, and SVG
 * text does not wrap, so each label is broken into lines here by a character
 * budget sized for its slot.
 */

/** Break a label into at most `maxLines` lines of about `maxChars`, on spaces.
 * A word longer than the budget keeps its own line; overflow joins the last. */
export function wrapLabel(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')]
}

export const DIAGRAM = {
  width: 720,
  height: 340,
  node: { w: 200, h: 64 },
  insurer: { x: 260, y: 16 },
  policyholder: { x: 30, y: 232 },
  buyer: { x: 490, y: 232 },
  /** Characters per line for each label slot at 13px. */
  chars: { side: 24, inner: 22, bottom: 30 },
} as const
