/**
 * Every task the database can open must render: a badge label for its TYPE
 * and a title for its title KEY. The locale parity test cannot catch a key
 * missing in all three languages at once — which is how 16 task types and
 * `agenda.tasks.buyer_proposed` reached the dashboard as raw keys.
 */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import VALIDATION from '../../../supabase/migrations/0060_limit_validation.sql?raw'
import { VALIDATION_STATUSES } from '../limits/validation'
import { OBJECT_FILTERS } from './catalogue'
import { TASK_TYPES } from './types'

const MIGRATIONS = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const titleKeys = new Set<string>()
const openedTypes = new Set<string>()
for (const text of Object.values(MIGRATIONS)) {
  for (const m of text.matchAll(/'agenda\.tasks\.([a-z_]+)'/g)) titleKeys.add(m[1]!)
  for (const m of text.matchAll(/open_task\(\s*'([a-z_]+)'/g)) openedTypes.add(m[1]!)
}

/** The validation outcomes the author is told about: every status but the
 * pending one and the two that open no result task (0060's mapping). */
const VALIDATION_RESULT_STATUSES = VALIDATION_STATUSES.filter(
  (s) => s !== 'pending' && s !== 'forwarded' && s !== 'cancelled',
)

describe('0060 result titles', () => {
  it('opens a result task for every status but forwarded and cancelled', () => {
    expect(VALIDATION).toContain("if new.payload ->> 'status' not in ('forwarded', 'cancelled') and new.target_user is not null then")
    expect(VALIDATION).toContain("'agenda.tasks.limit_validation_result_' || (new.payload ->> 'status')")
    expect(VALIDATION_RESULT_STATUSES).toEqual(['approved', 'approved_modified', 'returned', 'rejected'])
  })
})

describe.each([
  ['en', en],
  ['ru', ru],
  ['uz', uz],
] as const)('%s agenda keys', (_lang, locale) => {
  const agenda = (
    locale as {
      agenda: {
        taskTypes: Record<string, string>
        tasks: Record<string, string>
        objectTypes: Record<string, string>
      }
    }
  ).agenda

  it('names every object kind the filter can offer', () => {
    expect(OBJECT_FILTERS.filter((kind) => !agenda.objectTypes[kind])).toEqual([])
  })

  it('names every task type the app knows and every type a migration opens', () => {
    const types = new Set<string>([...TASK_TYPES, ...openedTypes])
    expect([...types].filter((type) => !agenda.taskTypes[type])).toEqual([])
  })

  it('has a title for every title key a migration writes', () => {
    expect(titleKeys.size).toBeGreaterThan(20)
    // A key written as a prefix plus a status needs a title per outcome:
    // '…_resolved_' || status (0054), '…_result_' || status (0060).
    const outcomes: Record<string, readonly string[]> = {
      entity_request_resolved_: ['created', 'linked', 'updated', 'rejected'],
      limit_validation_result_: VALIDATION_RESULT_STATUSES,
    }
    const prefixes = [...titleKeys].filter((key) => key.endsWith('_'))
    expect(prefixes.filter((key) => !outcomes[key])).toEqual([])
    const expanded = [...titleKeys].flatMap((key) => (key.endsWith('_') ? outcomes[key]!.map((s) => key + s) : [key]))
    expect(expanded.filter((key) => !agenda.tasks[key])).toEqual([])
  })
})
