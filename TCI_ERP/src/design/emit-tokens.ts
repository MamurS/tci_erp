/**
 * Writes src/design/tokens.css from palette.ts:
 *   npm run design:tokens
 * tokens.test.ts fails while the file and the palette disagree.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderTokensCss } from './palette.ts'

writeFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), renderTokensCss())
