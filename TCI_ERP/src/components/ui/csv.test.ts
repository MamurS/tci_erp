import { describe, expect, it } from 'vitest'

import { csvCell, toCsv } from './csv'

describe('csv', () => {
  it('quotes what needs quoting and nothing else', () => {
    expect(csvCell('Acme')).toBe('Acme')
    expect(csvCell('Acme, LLC')).toBe('"Acme, LLC"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
  })
  it('never lets a spreadsheet run a cell as a formula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })
  it('joins rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\r\n1,"x,y"')
  })
})
