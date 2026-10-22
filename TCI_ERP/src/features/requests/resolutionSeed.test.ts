import { describe, expect, it } from 'vitest'

import { nameCore, resolutionSeed } from './resolutionSeed'

const REGISTRY = ['Almaty Stroy Invest LLP', 'Tashkent Supermarket Chain MChJ', 'OOO Ozon Volga', 'Istanbul Tekstil A.Ş.']

describe('resolutionSeed', () => {
  it('drops the legal form and quotes', () => {
    expect(nameCore('TOO «Almaty Stroy Invest»')).toEqual(['Almaty', 'Stroy', 'Invest'])
    expect(nameCore('Istanbul Tekstil A.Ş.')).toEqual(['Istanbul', 'Tekstil'])
  })

  it('keeps the name as typed when the registry already holds it', () => {
    expect(resolutionSeed('OOO Ozon Volga', REGISTRY)).toBe('OOO Ozon Volga')
  })

  it('finds a company registered under another legal form', () => {
    expect(resolutionSeed('TOO Almaty Stroy Invest', REGISTRY)).toBe('Almaty Stroy Invest')
  })

  it('shortens the name from the end until something matches', () => {
    expect(resolutionSeed('Tashkent Supermarket Group', REGISTRY)).toBe('Tashkent Supermarket')
  })

  it('offers the bare name when nothing matches', () => {
    expect(resolutionSeed('MChJ Qwerty Zxcv', REGISTRY)).toBe('Qwerty Zxcv')
    expect(resolutionSeed('', REGISTRY)).toBeUndefined()
    expect(resolutionSeed(null, REGISTRY)).toBeUndefined()
  })
})
