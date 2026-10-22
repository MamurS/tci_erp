/** Owner-decided Russian terminology (CLAUDE.md glossary, 2026-10-22), plus
 * the one Uzbek decision taken with it. Each retired variant is listed by
 * name so a regression says exactly which word came back and where.
 *
 * «Убыток / убытки» stays where it is the ACCOUNTING loss (P&L, NQL,
 * deductibles, incurred losses) — only the claims department and the claim
 * object moved to «Претензии / Претензия». */

import { describe, expect, it } from 'vitest'

import ru from './locales/ru.json'
import uz from './locales/uz.json'

type Json = { [key: string]: string | Json }

function leaves(node: Json, prefix = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [[path, value] as [string, string]] : leaves(value as Json, path)
  })
}

const offenders = (dict: Json, pattern: RegExp) =>
  leaves(dict)
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => `${key}: ${value}`)

describe('ru: retired variants', () => {
  it.each([
    ['NQL «Некредитуемый…»', /некредитуем/i],
    ['NQL «Некомпенсируемый…»', /некомпенсируем/i],
    ['AFL «Совокупная франшиза»', /совокупн\S* франшиз/i],
    ['grade band «рейтинговый класс»', /рейтингов\S* класс/i],
    ['engine limit «Расчётный лимит»', /расч[её]тн\S* лимит/i],
    ['claim «Требование о возмещении»', /требовани\S* о возмещении/i],
  ])('no ru string uses %s', (_label, pattern) => {
    expect(offenders(ru as Json, pattern)).toEqual([])
  })
})

describe('ru: owner-decided terms', () => {
  it('the claims department is «Претензии», never «Убытки»', () => {
    const labels = {
      'nav.claims': ru.nav.claims,
      'nav.workspaces.claims.name': ru.nav.workspaces.claims.name,
      'roles.claims': ru.roles.claims,
      'agenda.families.claims': ru.agenda.families.claims,
      'agenda.comments.authors.claims': ru.agenda.comments.authors.claims,
      'portal.nav.claims': ru.portal.nav.claims,
      'claims.title': ru.claims.title,
    }
    for (const [key, label] of Object.entries(labels)) {
      expect(label, key).toBe('Претензии')
    }
    expect(ru.roles.descriptions.claims).not.toMatch(/убыт/i)
  })

  it('a single claim is «Претензия»', () => {
    expect(ru.agenda.tags.claim).toBe('Претензия')
    expect(ru.agenda.objectTypes.claim).toBe('Претензия')
    expect(ru.claims.eyebrow).toBe('Претензия')
    expect(ru.claims.fields.number).toBe('Претензия')
  })

  it('accounting loss keeps «убыток»', () => {
    expect(ru.fin.sections.profitAndLoss).toContain('убытки')
    expect(ru.portfolio.policies.incurred).toBe('Понесённые убытки')
  })

  it('NQL, insured percentage and AFL use the decided names', () => {
    expect(ru.policies.terms.nql).toBe('Невозмещаемые убытки (NQL)')
    expect(ru.requests.terms.nql_amount).toBe('Невозмещаемые убытки (NQL)')
    expect(ru.policies.terms.insuredPercentage).toBe('Процент покрытия')
    expect(ru.requests.terms.insured_percentage).toBe('Процент покрытия')
    expect(ru.policies.terms.aggregateFirstLoss).toBe('Агрегатная франшиза')
    expect(ru.claims.fields.aggregateFirstLoss).toBe('Агрегатная франшиза')
  })

  it('the grade band is «Диапазон рейтинга»', () => {
    expect(ru.admin.fields.band).toBe('Диапазон рейтинга')
    expect(ru.limits.preflight.within).toContain('в диапазоне рейтинга «{{band}}»')
  })

  it('the engine-calculated limit is «Рекомендуемый лимит»', () => {
    expect(ru.report.calculatedLimit).toBe('Рекомендуемый лимит')
    expect(ru.agenda.triage.limit.engine).toBe('Рекомендуемый лимит')
  })

  it('a claim refers to the «полис», not the «договор»', () => {
    expect(ru.claims.fields.policy).toBe('Полис')
    expect(ru.portal.claims.fields.policy).toBe('Полис')
  })
})

describe('uz: overdue notification is «xabarnoma»', () => {
  it('no uz string still says «bildirishnoma» in any form', () => {
    expect(offenders(uz as Json, /bildirishnom/i)).toEqual([])
  })
})
