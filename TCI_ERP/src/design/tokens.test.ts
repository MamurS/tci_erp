import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderTokensCss } from './palette'

describe('tokens.css', () => {
  it('is generated from palette.ts (npm run design:tokens)', () => {
    // Read from disk: vitest hands CSS imports over empty, ?raw included.
    expect(readFileSync(join(__dirname, 'tokens.css'), 'utf8')).toBe(renderTokensCss())
  })
})
