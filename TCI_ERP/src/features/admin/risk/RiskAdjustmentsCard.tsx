/**
 * Admin › Риски › «Матрица покрытия и поправки» (migration 0085,
 * tci.risk_adjustment_settings): one line per sector grade A–D and per OECD
 * country category 0–7 plus «not classified». A line notches and may cap
 * the engine's grade, marks cover as available or restricted, sets the
 * authority rank a decision needs (the country's floor, the sector's
 * addition — the only two tci.cover_required_rank_internal reads) and an
 * informational premium loading. Each line is edited in place and saved on
 * its own (tci.save_risk_adjustment); the bounds are 0085's checks
 * (riskSettingsForm.ts).
 */

import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Card, COL, SectionTitle, Select, Skeleton, Table, useFlash } from '../../../components/ui'
import { parseAmount } from '../../../components/ui/amount'
import { refusalOr } from '../../../lib/optimistic'
import { useRiskSettings, useSaveRiskAdjustment } from '../../risk/api'
import type { RiskAdjustment } from '../../risk/rules'
import { CAP_GRADES, COVER_STATES, RISK_BOUNDS, adjustmentProblems, rankColumn, sameAdjustment } from './riskSettingsForm'
import type { AdjustmentField } from './riskSettingsForm'

/** A line as typed: numbers stay text until they are read. */
interface Draft {
  notch: string
  cap_grade: string
  cover: RiskAdjustment['cover']
  rank: string
  premium_loading_pct: string
}

const lineKey = (a: Pick<RiskAdjustment, 'dimension' | 'key'>) => `${a.dimension}:${a.key}`

function toDraft(a: RiskAdjustment): Draft {
  return {
    notch: String(a.notch),
    cap_grade: a.cap_grade ?? '',
    cover: a.cover,
    rank: String(a[rankColumn(a)]),
    premium_loading_pct: String(a.premium_loading_pct),
  }
}

/** A typed number, or NaN (which no bound accepts) when empty. */
function readNumber(text: string): number {
  return parseAmount(text) ?? Number.NaN
}

/** The line the draft would save: the other rank column is sent unchanged. */
function fromDraft(a: RiskAdjustment, d: Draft): RiskAdjustment {
  return {
    ...a,
    notch: readNumber(d.notch),
    cap_grade: d.cap_grade || null,
    cover: d.cover,
    [rankColumn(a)]: readNumber(d.rank),
    premium_loading_pct: readNumber(d.premium_loading_pct),
  }
}

export function RiskAdjustmentsCard() {
  const { t } = useTranslation()
  const settings = useRiskSettings()
  const lines = settings.data?.adjustments ?? []
  const sectors = lines.filter((a) => a.dimension === 'sector')
  const countries = lines.filter((a) => a.dimension === 'country')

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.risk.adjustments.hint')}>{t('admin.risk.adjustments.title')}</SectionTitle>

      <ul className="grid gap-x-6 gap-y-1 text-small text-slate-600 sm:grid-cols-2">
        <li>
          <span className="font-medium text-slate-800">{t('admin.risk.adjustments.columns.notch')}</span> —{' '}
          {t('admin.risk.adjustments.explain.notch')}
        </li>
        <li>
          <span className="font-medium text-slate-800">{t('admin.risk.adjustments.columns.cap')}</span> —{' '}
          {t('admin.risk.adjustments.explain.cap')}
        </li>
        <li>
          <span className="font-medium text-slate-800">{t('admin.risk.adjustments.columns.cover')}</span> —{' '}
          {t('admin.risk.adjustments.explain.cover')}
        </li>
        <li>
          <span className="font-medium text-slate-800">{t('admin.risk.adjustments.columns.rank')}</span> —{' '}
          {t('admin.risk.adjustments.explain.rank')}
        </li>
        <li>
          <span className="font-medium text-slate-800">{t('admin.risk.adjustments.columns.loading')}</span> —{' '}
          {t('admin.risk.adjustments.explain.loading')}
        </li>
      </ul>

      <Callout tone="info" title={t('admin.risk.adjustments.matrixTitle')}>
        {t('admin.risk.adjustments.matrix')}
      </Callout>

      {settings.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : settings.isError ? (
        <Callout tone="neg" title={t('admin.risk.adjustments.loadFailed')} />
      ) : (
        <Table dense columns={[COL.fill, '6.5rem', '7.5rem', '10rem', '7rem', '8rem', '9.5rem']} fillMin="10rem">
          <thead>
            <tr>
              <th>{t('admin.risk.adjustments.columns.line')}</th>
              <th>{t('admin.risk.adjustments.columns.notch')}</th>
              <th>{t('admin.risk.adjustments.columns.cap')}</th>
              <th>{t('admin.risk.adjustments.columns.cover')}</th>
              <th>{t('admin.risk.adjustments.columns.rank')}</th>
              <th>{t('admin.risk.adjustments.columns.loading')}</th>
              <th aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['sector', sectors],
                ['country', countries],
              ] as const
            ).map(([dimension, group]) => (
              <Fragment key={dimension}>
                <tr>
                  <td colSpan={7} className="bg-slate-50 font-semibold text-slate-700">
                    {t(`admin.risk.adjustments.groups.${dimension}`)}
                  </td>
                </tr>
                {group.map((a) => (
                  <AdjustmentRow key={lineKey(a)} line={a} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

function AdjustmentRow({ line }: { line: RiskAdjustment }) {
  const { t } = useTranslation()
  const save = useSaveRiskAdjustment()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, flashSaved] = useFlash()
  const d = draft ?? toDraft(line)
  const next = fromDraft(line, d)
  const problems = adjustmentProblems(next)
  const changed = !sameAdjustment(line, next)
  const bad = (f: AdjustmentField) => draft !== null && problems.includes(f)
  const rankField = rankColumn(line)
  const rankBounds = rankField === 'rank_floor' ? RISK_BOUNDS.rankFloor : RISK_BOUNDS.rankAdd

  const edit = (patch: Partial<Draft>) => {
    setError(null)
    setDraft({ ...d, ...patch })
  }

  const label =
    line.dimension === 'sector'
      ? t('admin.risk.adjustments.sectorLine', { grade: line.key })
      : line.key === 'unclassified'
        ? t('risk.country.unclassifiedShort')
        : t('admin.risk.adjustments.countryLine', { category: line.key })

  return (
    <>
      <tr>
        <td className="font-medium text-slate-800">{label}</td>
        <td className="!overflow-visible" data-invalid={bad('notch') ? '' : undefined}>
          <AmountInput
            decimals={0}
            allowNegative
            value={d.notch}
            aria-label={`${label} — ${t('admin.risk.adjustments.columns.notch')}`}
            title={t('admin.risk.adjustments.bounds', RISK_BOUNDS.notch)}
            onChange={(v) => edit({ notch: v })}
          />
        </td>
        <td className="!overflow-visible">
          <Select
            value={d.cap_grade}
            aria-label={`${label} — ${t('admin.risk.adjustments.columns.cap')}`}
            onChange={(e) => edit({ cap_grade: e.target.value })}
          >
            <option value="">{t('admin.risk.adjustments.noCap')}</option>
            {CAP_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </td>
        <td className="!overflow-visible">
          <Select
            value={d.cover}
            aria-label={`${label} — ${t('admin.risk.adjustments.columns.cover')}`}
            onChange={(e) => edit({ cover: e.target.value as RiskAdjustment['cover'] })}
          >
            {COVER_STATES.map((c) => (
              <option key={c} value={c}>
                {t(`admin.risk.adjustments.cover.${c}`)}
              </option>
            ))}
          </Select>
        </td>
        <td className="!overflow-visible" data-invalid={bad(rankField) ? '' : undefined}>
          <AmountInput
            decimals={0}
            value={d.rank}
            aria-label={`${label} — ${t(rankField === 'rank_floor' ? 'admin.risk.adjustments.rankFloor' : 'admin.risk.adjustments.rankAdd')}`}
            title={t(rankField === 'rank_floor' ? 'admin.risk.adjustments.rankFloor' : 'admin.risk.adjustments.rankAdd')}
            onChange={(v) => edit({ rank: v })}
          />
        </td>
        <td className="!overflow-visible" data-invalid={bad('premium_loading_pct') ? '' : undefined}>
          <AmountInput
            decimals={2}
            suffix="%"
            value={d.premium_loading_pct}
            aria-label={`${label} — ${t('admin.risk.adjustments.columns.loading')}`}
            title={t('admin.risk.adjustments.bounds', RISK_BOUNDS.premiumLoading)}
            onChange={(v) => edit({ premium_loading_pct: v })}
          />
        </td>
        <td className="!overflow-visible">
          <div className="flex items-center justify-end gap-2">
            {changed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(null)
                  setError(null)
                }}
              >
                {t('admin.risk.adjustments.undo')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!changed || problems.length > 0}
              loading={save.isPending}
              done={saved}
              onClick={() =>
                save.mutate(next, {
                  onSuccess: () => {
                    setDraft(null)
                    flashSaved()
                  },
                  onError: (failure) => setError(t(refusalOr(failure, 'admin.risk.adjustments.saveFailed'))),
                })
              }
            >
              {t('common.save')}
            </Button>
          </div>
        </td>
      </tr>
      {(error || (draft !== null && problems.length > 0)) && (
        <tr>
          <td colSpan={7} className="!whitespace-normal">
            <span className="text-caption font-medium text-danger-700" role="alert">
              {error ??
                problems
                  .map((f) =>
                    t(`admin.risk.adjustments.invalid.${f}`, {
                      ...(f === 'rank_floor' || f === 'rank_add' ? rankBounds : f === 'notch' ? RISK_BOUNDS.notch : RISK_BOUNDS.premiumLoading),
                    }),
                  )
                  .join(' · ')}
            </span>
          </td>
        </tr>
      )}
    </>
  )
}
