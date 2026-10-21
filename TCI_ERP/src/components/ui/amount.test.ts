import { describe, expect, it } from 'vitest'

import { amountToPlain, caretAfterGrouping, cleanAmount, groupAmount, parseAmount, significantBefore } from './amount'

describe('amount entry', () => {
  it('groups thousands with a comma as it is typed', () => {
    expect(groupAmount(cleanAmount('5235235523535'))).toBe('5,235,235,523,535')
    expect(groupAmount(cleanAmount('1000000.5'))).toBe('1,000,000.5')
    expect(groupAmount(cleanAmount('1000.'))).toBe('1,000.')
    expect(groupAmount('')).toBe('')
  })

  it('accepts what people paste and keeps only a sane number', () => {
    expect(cleanAmount('1,234,567.891')).toBe('1234567.89')
    expect(cleanAmount('1 234 567,50')).toBe('1234567.50')
    expect(cleanAmount('USD 12abc3')).toBe('123')
    expect(cleanAmount('007')).toBe('7')
    expect(cleanAmount('.5')).toBe('0.5')
    expect(cleanAmount('1.2.3')).toBe('1.23')
    expect(cleanAmount('12.5', 0)).toBe('12')
    expect(cleanAmount('-50', 2)).toBe('50')
    expect(cleanAmount('-50', 2, true)).toBe('-50')
  })

  it('parses the plain value, and empty is null — never 0', () => {
    expect(parseAmount('1234.5')).toBe(1234.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('-')).toBeNull()
    expect(amountToPlain(1500000)).toBe('1500000')
    expect(amountToPlain('2500.50')).toBe('2500.5')
    expect(amountToPlain(null)).toBe('')
  })

  it('keeps the caret after the same digit when the grouping moves', () => {
    // typing "5" after "1,23|4" -> "12354" -> "12,354": caret after the 5
    const typed = '1,235|4'.replace('|', '')
    const before = significantBefore(typed, 5)
    expect(before).toBe(4)
    expect(caretAfterGrouping(groupAmount(cleanAmount(typed)), before)).toBe(5)
    // the caret at the very start stays there
    expect(caretAfterGrouping('1,000', 0)).toBe(0)
  })
})
