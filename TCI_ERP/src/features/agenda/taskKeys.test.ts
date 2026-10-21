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

describe.each([
  ['en', en],
  ['ru', ru],
  ['uz', uz],
] as const)('%s agenda keys', (_lang, locale) => {
  const agenda = (locale as { agenda: { taskTypes: Record<string, string>; tasks: Record<string, string> } }).agenda

  it('names every task type the app knows and every type a migration opens', () => {
    const types = new Set<string>([...TASK_TYPES, ...openedTypes])
    expect([...types].filter((type) => !agenda.taskTypes[type])).toEqual([])
  })

  it('has a title for every title key a migration writes', () => {
    expect(titleKeys.size).toBeGreaterThan(20)
    // A key written as a prefix plus a status ('…_resolved_' || status, 0054)
    // needs a title per outcome.
    const expanded = [...titleKeys].flatMap((key) =>
      key.endsWith('_') ? ['created', 'linked', 'updated', 'rejected'].map((s) => key + s) : [key],
    )
    expect(expanded.filter((key) => !agenda.tasks[key])).toEqual([])
  })
})
