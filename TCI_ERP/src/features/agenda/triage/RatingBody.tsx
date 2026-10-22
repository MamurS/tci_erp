/**
 * A rating task in triage: new statements to rate on, a rating gone stale, a
 * buyer never rated. The strip sets the current assessment against the
 * statements now on file and the limits that hang on it; «what moved» is the
 * risk report's own commentary on the rated statement and the new one. The
 * rating itself is recalculated on the rating page, never here.
 */

import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { bandForGrade } from '../../../lib/roles'
import { useStatements } from '../../entities/api'
import { useAssessments } from '../../entities/rating/assessmentsApi'
import type { StatementBundle } from '../../entities/types'
import { useBuyerExposure } from '../../limits/api'
import { BandBadge } from '../../limits/workbench/parts'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { periodLabel } from '../rowText'
import { GenericBody } from './GenericBody'
import { movedChipText, negativeCfoStreak, num, whatMoved } from './figures'
import { useExposureFigure } from './hooks'
import { BodySkeleton, ChipList, FigureStrip, Muted, Section } from './parts'
import type { Figure } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function label(t: TFunction, s: StatementBundle): string {
  return periodLabel(t, s.fiscal_year, s.fiscal_quarter, s.statement_kind)
}

export function RatingBody(props: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  // A merged row may lead with another rating type; the new-statements task,
  // when present, names the statement that started it.
  const fresh = props.row.tasks.find((task) => task.task_type === 'rating_new_statements') ?? null
  const entityId = str(lead.params?.entity_id) ?? lead.object_id
  const assessments = useAssessments(entityId)
  const statements = useStatements(entityId)
  const exposure = useBuyerExposure(entityId)
  const dependsFigure = useExposureFigure(exposure.data ?? null)

  if (assessments.isLoading || statements.isLoading || exposure.isLoading) return <BodySkeleton />
  if (assessments.isError || statements.isError) return <GenericBody {...props} />

  const latest = assessments.data?.[0] ?? null
  const list = statements.data ?? []
  const rated = latest ? (list.find((s) => s.id === latest.statement_id) ?? null) : null
  // Newest period first (useStatements' order); the task's own statement wins.
  const newest = (fresh && list.find((s) => s.id === fresh.params?.statement_id)) || list[0] || null
  const newer = newest && (!rated || newest.period_end_date > rated.period_end_date) ? newest : null

  const current: Figure = latest
    ? {
        label: t('agenda.triage.rating.current'),
        value: (
          <>
            <BandBadge band={bandForGrade(latest.rating_grade)} grade={latest.rating_grade} />
            <span>{formatAmount(num(latest.rating_score), locale, 1)}</span>
          </>
        ),
        sub: [
          rated ? t('agenda.triage.rating.onPeriod', { period: label(t, rated) }) : null,
          t('agenda.triage.rating.ratedOn', { date: formatDate(latest.created_at, locale) }),
        ]
          .filter(Boolean)
          .join(' · '),
      }
    : { label: t('agenda.triage.rating.current'), value: EM_DASH, sub: t('rating.notRated') }

  const statementFigure: Figure = newer
    ? {
        label: t('agenda.triage.rating.newStatements'),
        value: label(t, newer),
        sub: statementFacts(t, newer, locale, newer.id === fresh?.params?.statement_id ? str(fresh?.params?.added_at) : null),
        tone: 'accent',
      }
    : newest
      ? {
          label: t('agenda.triage.rating.latestStatements'),
          value: label(t, newest),
          sub: t('agenda.triage.rating.noNewer'),
        }
      : // Nothing to rate on: the information manager's work comes first.
        { label: t('agenda.triage.rating.latestStatements'), value: EM_DASH, sub: t('agenda.triage.rating.noStatements'), tone: 'warn' }

  const moved = rated && newer ? whatMoved(rated, newer) : null
  // A warning the commentary does not make: operating cash flow negative for
  // a second period running (or longer) up to the new statements.
  const cfoStreak = moved?.comparable && newer ? negativeCfoStreak(newer, list) : 0

  return (
    <>
      <FigureStrip figures={[current, statementFigure, dependsFigure]} />
      {moved && rated && newer && (
        <Section title={t('agenda.triage.rating.moved', { from: label(t, rated), to: label(t, newer) })}>
          {!moved.comparable ? (
            <Muted>{t(`agenda.triage.rating.notComparable.${moved.reason}`)}</Muted>
          ) : moved.chips.length === 0 && cfoStreak < 2 ? (
            <Muted>{t('agenda.triage.rating.nothingMoved')}</Muted>
          ) : (
            <ChipList
              chips={[
                ...moved.chips.map((s) => ({
                  key: s.metric,
                  text: movedChipText(s, moved.currency, t, locale),
                  tone: s.tone,
                })),
                ...(cfoStreak >= 2
                  ? [{ key: 'cfo', text: t('agenda.triage.rating.cfoNegative', { count: cfoStreak }), tone: 'neg' as const }]
                  : []),
              ]}
            />
          )}
        </Section>
      )}
      <Muted className="mt-5">{t('agenda.triage.rating.notHere')}</Muted>
    </>
  )
}

/** «Statutory · IFRS · added 15 Apr 2026». */
function statementFacts(t: TFunction, s: StatementBundle, locale: string, addedAt: string | null): string {
  return [
    t(`fin.reportTypes.${s.report_type}`),
    s.accounting_basis === 'ifrs' ? t('fin.local.badgeIfrs') : t('fin.local.badgeLocal'),
    t('agenda.triage.rating.added', { date: formatDate(addedAt ?? s.created_at, locale) }),
  ].join(' · ')
}
