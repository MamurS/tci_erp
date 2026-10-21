/**
 * A declaration in triage: the period, where it stands, and — once it exists
 * — its totals with the covered / uncovered split the database resolved
 * (v_declaration_totals). A declaration that is due or late may not exist
 * yet; then the period and the policy are all there is to show.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { DescriptionList } from '../../../components/ui'
import { EM_DASH, formatAmount, formatMoment, formatPeriod } from '../../../lib/format'
import { useDeclaration, useDeclarationTotals, useDeclarations } from '../../declarations/api'
import { STATUS_TONE } from '../../declarations/status'
import type { Declaration } from '../../declarations/types'
import { policyIdOf } from '../api'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { GenericBody } from './GenericBody'
import { num } from './figures'
import { BodySkeleton, FigureStrip, Section, StatusBadge } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

type Props = { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }

export function DeclarationBody(props: Props) {
  const lead = props.row.lead
  if (lead.object_type === 'declaration') return <ByDeclaration {...props} declarationId={lead.object_id} />
  return <ByPeriod {...props} />
}

/** declaration_due / declaration_overdue: the object is the policy. */
function ByPeriod(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  const p = lead.params ?? {}
  const policyId = policyIdOf(lead) ?? undefined
  const { data: declarations, isLoading, isError } = useDeclarations(policyId)
  const start = str(p.period_start)
  const end = str(p.period_end)

  if (isLoading) return <BodySkeleton strip={false} />
  if (isError) return <GenericBody {...props} />
  // The live declaration for the period: a corrected one has been replaced.
  const found = declarations?.find((d) => d.period_start === start && d.status !== 'corrected') ?? null
  if (found) return <ByDeclaration {...props} declarationId={found.id} />

  const policy = policyId ? props.subjects?.policies[policyId] : undefined
  return (
    <Section title={t('agenda.triage.declaration.title')}>
      <DescriptionList
        columns={2}
        items={[
          { label: t('declarations.fields.period'), value: start && end ? formatPeriod(start, end, locale) : EM_DASH },
          { label: t('declarations.fields.status'), value: t('agenda.triage.declaration.notReceived') },
          {
            label: t('agenda.triage.policy'),
            value: policyId ? (
              <Link to={`/policies/${policyId}`} className="text-accent-600 hover:underline">
                {policy?.number ?? str(p.policy_number) ?? EM_DASH}
              </Link>
            ) : (
              EM_DASH
            ),
          },
          { label: t('agenda.triage.policyholder'), value: policy?.holder ?? EM_DASH },
        ]}
      />
    </Section>
  )
}

function ByDeclaration(props: Props & { declarationId: string }) {
  const { declarationId } = props
  const declaration = useDeclaration(declarationId)
  const totals = useDeclarationTotals(declarationId)
  if (declaration.isLoading || totals.isLoading) return <BodySkeleton />
  if (declaration.isError || !declaration.data) return <GenericBody {...props} />
  return <DeclarationFacts {...props} declaration={declaration.data} totals={totals.data ?? null} />
}

function DeclarationFacts({
  row,
  declaration,
  totals,
}: Props & {
  declaration: Declaration & { policies?: { policy_number: string; legal_entities?: { name: string } | null } | null }
  totals: { total_insurable_turnover: number; covered_turnover: number; uncovered_excess: number; line_count: number } | null
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const ccy = declaration.currency_code
  const uncovered = totals ? num(totals.uncovered_excess) : null
  const reviewingExcess = row.displayType === 'uncovered_excess_review'
  return (
    <>
      {totals && (
        <FigureStrip
          figures={[
            { label: t('declarations.fields.totalTurnover'), value: formatAmount(num(totals.total_insurable_turnover), locale), sub: ccy },
            { label: t('declarations.fields.coveredTurnover'), value: formatAmount(num(totals.covered_turnover), locale), sub: ccy },
            {
              label: t('declarations.fields.uncoveredExcess'),
              value: formatAmount(uncovered, locale),
              sub: ccy,
              tone: reviewingExcess && uncovered !== null && uncovered > 0 ? 'warn' : 'default',
            },
          ]}
        />
      )}
      <Section title={t('agenda.triage.declaration.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t('declarations.fields.period'),
              value: (
                <Link to={`/declarations/${declaration.id}`} className="text-accent-600 hover:underline">
                  {formatPeriod(declaration.period_start, declaration.period_end, locale)}
                </Link>
              ),
            },
            {
              label: t('declarations.fields.status'),
              value: <StatusBadge tone={STATUS_TONE[declaration.status]}>{t(`declarations.statuses.${declaration.status}`)}</StatusBadge>,
            },
            {
              label: t('agenda.triage.policy'),
              value: (
                <Link to={`/policies/${declaration.policy_id}`} className="text-accent-600 hover:underline">
                  {declaration.policies?.policy_number ?? EM_DASH}
                </Link>
              ),
            },
            { label: t('agenda.triage.policyholder'), value: declaration.policies?.legal_entities?.name ?? EM_DASH },
            {
              label: t('declarations.fields.submittedAt'),
              value: declaration.submitted_at ? formatMoment(declaration.submitted_at, locale) : EM_DASH,
            },
            { label: t('agenda.triage.declaration.lines'), value: totals ? totals.line_count : EM_DASH },
          ]}
        />
      </Section>
    </>
  )
}
