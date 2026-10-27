import { describe, expect, it } from 'vitest'

import { clampSplit } from './splitWidth'

describe('split width', () => {
  it('stays between the least width and a share of the screen', () => {
    expect(clampSplit(10, 18, 80, 0.65)).toBe(18)
    expect(clampSplit(30, 18, 80, 0.65)).toBe(30)
    expect(clampSplit(70, 18, 80, 0.65)).toBe(52)
    // a narrow container never takes the pane below its least width
    expect(clampSplit(30, 18, 20, 0.65)).toBe(18)
  })
})
