/** The fallback panel body: the facts the task itself carries. */

import { useTranslation } from 'react-i18next'

import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { rowFacts } from '../rowText'

export function GenericBody({ row, subjects }: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const facts = rowFacts(row, t, i18n.language, subjects)
  if (facts.length === 0) return null
  return (
    <section className="mt-6 border-t border-slate-100 pt-5">
      <h3 className="mb-2 text-caption font-semibold tracking-[0.08em] text-slate-600 uppercase">{t('agenda.triage.facts')}</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body text-slate-800 tabular-nums">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </section>
  )
}
