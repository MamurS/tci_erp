import { describe, expect, it } from 'vitest'

import TABLES from '../../../credit_engine/src/credit_engine/scoring/tables.py?raw'
import EN from '../i18n/locales/en.json'
import RU from '../i18n/locales/ru.json'
import UZ from '../i18n/locales/uz.json'
import { GRADE_CODES, gradeCodes, isGradeCode } from './gradeCatalogue'

describe('grade catalogue (mirror of credit_engine GRADE_BANDS)', () => {
  it('lists exactly the engine’s grades, best first', () => {
    const block = TABLES.slice(
      TABLES.indexOf('GRADE_BANDS: tuple'),
      TABLES.indexOf('def grade_for'),
    )
    const codes = [...block.matchAll(/GradeBandDef\("([A-D][0-9]*)"/g)].map((m) => m[1])
    expect(codes).toEqual([...GRADE_CODES])
  })

  it('every grade matches the scale confirm_rating accepts (0069)', () => {
    for (const code of GRADE_CODES) expect(code).toMatch(/^[A-D][0-9]{0,2}$/)
  })

  it('prefers the served scale', () => {
    expect(gradeCodes(undefined)).toEqual([...GRADE_CODES])
    expect(
      gradeCodes([{ code: 'A1', label_key: 'x', lower: 0, upper: 10, risk_coefficient: 1 }]),
    ).toEqual(['A1'])
    expect(isGradeCode('B1')).toBe(true)
    expect(isGradeCode('B3')).toBe(false)
  })

  it('every grade has a name, a risk line and a description in en, ru and uz', () => {
    for (const locale of [EN, RU, UZ] as unknown as Array<{
      rating: { grades: Record<string, Record<string, string> | undefined> }
    }>) {
      for (const code of GRADE_CODES) {
        const g = locale.rating.grades[code]
        expect(g?.name, code).toBeTruthy()
        expect(g?.risk, code).toBeTruthy()
        expect(g?.description, code).toBeTruthy()
      }
    }
  })
})
