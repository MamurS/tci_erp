/**
 * The lines of one imported statement, in the order a person works them:
 * «Совпадения» (confident matches, one click for all), «Требуют проверки»
 * (a reference was found but the amount or the date disagree), «Не
 * распознаны» (nothing to go on: assign to a policy or set aside) and
 * «Обработаны» (collapsed).
 *
 * A line resolved here stays in the section it was in, with its new status,
 * until another import is opened — rows never jump between sections under
 * the pointer. Every write is the database's: the buttons only offer what
 * it accepts.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import {
  ActionsMenu,
  Badge,
  Button,
  COL,
  Callout,
  Combobox,
  Count,
  Modal,
  SectionTitle,
  Skeleton,
  Table,
  Textarea,
  actionsCol,
  labelCol,
} from '../../../components/ui'
import type { ComboOption, MenuAction } from '../../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { refusalKey } from '../../../lib/refusals'
import { useAssignBankLine, useBankLines, useConfirmBankLines, useIgnoreBankLine, usePaymentPolicies } from './api'
import type { PaymentPolicy } from './api'
import { LINE_SECTIONS, lineResultKey, lineStatusTone, matchReason, sectionOf } from './lines'
import type { BankLine, LineSection } from './lines'

/** One width per column, the same in every section so the four line up,
 * and narrow enough for a laptop (≈ 58rem with the fill at its minimum):
 * payer over purpose and policy over basis share a cell each, and the last
 * cell holds the line's actions while it is open and its outcome once it is
 * worked — in a box wide enough for either. Every row is two lines tall,
 * so a status change never changes its height. */
const COLUMNS = [
  COL.date,
  COL.money,
  COL.fill,
  labelCol('bankMatchReason'),
  `max(${labelCol('bankLineStatus')}, ${actionsCol(['bankLineAction'], 1)})`,
]

/** A refusal to show above the sections: which line, and why. */
interface LineProblem {
  line_no: number | null
  key: string
}

export function ImportLines({ importId }: { importId: string }) {
  const { t } = useTranslation()
  const { data: lines, isLoading, isError } = useBankLines(importId)
  const { data: policies } = usePaymentPolicies()
  const confirm = useConfirmBankLines(importId)
  const ignore = useIgnoreBankLine(importId)

  // Where a line resolved in this visit was when it was resolved (see above).
  const [moved, setMoved] = useState<Record<string, LineSection>>({})
  const [problems, setProblems] = useState<LineProblem[]>([])
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [assigning, setAssigning] = useState<BankLine | null>(null)
  const [ignoring, setIgnoring] = useState<BankLine | null>(null)
  const [showProcessed, setShowProcessed] = useState(false)

  const policyById = useMemo(() => new Map((policies ?? []).map((p) => [p.id, p])), [policies])
  const bySection = useMemo(() => {
    const out: Record<LineSection, BankLine[]> = { matched: [], suggested: [], unmatched: [], processed: [] }
    for (const line of lines ?? []) out[moved[line.id] ?? sectionOf(line.status)].push(line)
    return out
  }, [lines, moved])
  const lineNo = (id: string) => (lines ?? []).find((l) => l.id === id)?.line_no ?? null

  /** Keep these lines where they are, then work on them. */
  const hold = (targets: readonly BankLine[]) =>
    setMoved((m) => {
      const next = { ...m }
      for (const l of targets) next[l.id] ??= sectionOf(l.status)
      return next
    })

  const runConfirm = (targets: readonly BankLine[]) => {
    if (!targets.length) return
    hold(targets)
    setProblems([])
    const ids = targets.map((l) => l.id)
    setPending((p) => new Set([...p, ...ids]))
    confirm.mutate(ids, {
      onSuccess: (results) =>
        setProblems(
          results
            .filter((r) => r.result !== 'recorded')
            .map((r) => ({ line_no: lineNo(r.line_id), key: lineResultKey(r.result) })),
        ),
      onError: (error) => setProblems([{ line_no: targets.length === 1 ? targets[0]!.line_no : null, key: refusalKey(error) }]),
      onSettled: () =>
        setPending((p) => {
          const next = new Set(p)
          for (const id of ids) next.delete(id)
          return next
        }),
    })
  }

  const runIgnore = (line: BankLine, reason: string) => {
    hold([line])
    setProblems([])
    setIgnoring(null)
    ignore.mutate(
      { lineId: line.id, reason },
      { onError: (error) => setProblems([{ line_no: line.line_no, key: refusalKey(error) }]) },
    )
  }

  if (isLoading) return <Skeleton className="h-48" />
  if (isError || !lines) return <Callout tone="neg" title={t('premium.bank.lines.loadFailed')} />

  const confirmable = bySection.matched.filter((l) => l.status === 'matched' && !pending.has(l.id))
  const open = lines.filter((l) => sectionOf(l.status) !== 'processed').length

  const rowActions = (line: BankLine) => {
    if (sectionOf(line.status) === 'processed')
      return <Badge tone={lineStatusTone(line.status)}>{t(`premium.bank.statuses.${line.status}`)}</Badge>
    const busy = pending.has(line.id)
    const menu: MenuAction[] = []
    if (line.status !== 'unmatched')
      menu.push({ key: 'assign', label: t('premium.bank.actions.assignOther'), onSelect: () => setAssigning(line) })
    menu.push({ key: 'ignore', label: t('premium.bank.actions.ignore'), onSelect: () => setIgnoring(line) })
    return (
      <>
        {line.status === 'unmatched' ? (
          <Button size="sm" variant="ghost" onClick={() => setAssigning(line)}>
            {t('premium.bank.actions.assign')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} aria-busy={busy} onClick={() => runConfirm([line])}>
            {t('premium.bank.actions.confirm')}
          </Button>
        )}
        <ActionsMenu trigger="icon" size="sm" label={t('common.actions')} actions={menu} disabled={busy} />
      </>
    )
  }

  const table = (rows: readonly BankLine[]) => (
    <Table columns={COLUMNS}>
      <thead>
        <tr>
          <th>{t('premium.bank.fields.value_date')}</th>
          <th className="num">{t('premium.bank.fields.amount')}</th>
          <th>{t('premium.bank.fields.payerPurpose')}</th>
          <th>{t('premium.bank.fields.policyBasis')}</th>
          <th>{t('premium.bank.fields.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((line) => (
          <LineRow key={line.id} line={line} policy={line.match_policy_id ? policyById.get(line.match_policy_id) : undefined}>
            {/* Not RowActions: left-aligned under its heading, and never clipped. */}
            <td className="!overflow-visible">
              <div className="flex items-center gap-2">{rowActions(line)}</div>
            </td>
          </LineRow>
        ))}
      </tbody>
    </Table>
  )

  const sectionTitle = (section: LineSection, actions?: ReactNode) => (
    <SectionTitle hint={t(`premium.bank.sections.${section}Hint`)} actions={actions}>
      <span className="flex items-center gap-2">
        {t(`premium.bank.sections.${section}`)}
        <Count value={bySection[section].length} className="bg-slate-100 text-slate-600" />
      </span>
    </SectionTitle>
  )

  return (
    <div className="flex flex-col gap-6">
      {problems.length > 0 && (
        <Callout tone="neg" title={t('premium.bank.lines.refused', { count: problems.length })}>
          <ul className="flex flex-col gap-0.5">
            {problems.map((p, i) => (
              <li key={i}>
                {p.line_no !== null ? t('premium.bank.lines.refusedLine', { line: p.line_no, reason: t(p.key) }) : t(p.key)}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {open === 0 && lines.length > 0 && (
        <Callout tone="pos" title={t('premium.bank.lines.allDone')}>
          {t('premium.bank.lines.allDoneHint')}
        </Callout>
      )}

      {LINE_SECTIONS.filter((s) => s !== 'processed').map((section) => (
        <section key={section} className="flex flex-col gap-3">
          {sectionTitle(
            section,
            section === 'matched' ? (
              <Button
                size="sm"
                disabled={!confirmable.length || confirm.isPending}
                aria-busy={confirm.isPending}
                onClick={() => runConfirm(confirmable)}
              >
                {t('premium.bank.actions.confirmAll')}
                <Count value={confirmable.length} className="bg-white/20" />
              </Button>
            ) : undefined,
          )}
          {bySection[section].length ? (
            table(bySection[section])
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-[0.8125rem] text-slate-500">
              {t(`premium.bank.sections.${section}Empty`)}
            </p>
          )}
        </section>
      ))}

      <section className="flex flex-col gap-3">
        {sectionTitle(
          'processed',
          <Button size="sm" variant="ghost" aria-expanded={showProcessed} onClick={() => setShowProcessed((v) => !v)}>
            {showProcessed ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {showProcessed ? t('premium.bank.sections.collapse') : t('premium.bank.sections.expand')}
          </Button>,
        )}
        {showProcessed &&
          (bySection.processed.length ? (
            table(bySection.processed)
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-[0.8125rem] text-slate-500">
              {t('premium.bank.sections.processedEmpty')}
            </p>
          ))}
      </section>

      {assigning && (
        <AssignModal
          line={assigning}
          importId={importId}
          policies={policies ?? []}
          onStart={() => {
            hold([assigning])
            setProblems([])
          }}
          onDone={() => setAssigning(null)}
          onClose={() => setAssigning(null)}
        />
      )}
      <IgnoreModal line={ignoring} onSubmit={runIgnore} onClose={() => setIgnoring(null)} />
    </div>
  )
}

function LineRow({ line, policy, children }: { line: BankLine; policy: PaymentPolicy | undefined; children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const reason = matchReason(line.match_reason)
  const resolved = sectionOf(line.status) === 'processed'
  const basis =
    line.status === 'ignored' && line.ignore_reason
      ? line.ignore_reason
      : reason
        ? t(`premium.bank.reasons.${reason}`)
        : EM_DASH
  const payerPurpose = [line.payer, line.purpose, line.reference && `№ ${line.reference}`].filter(Boolean).join(' · ')
  return (
    <tr className={resolved ? 'text-slate-500' : undefined}>
      <td>{formatDate(line.value_date, locale)}</td>
      <td className="num">
        {formatAmount(Number(line.amount), locale)} <span className="text-slate-500">{line.currency_code}</span>
      </td>
      <td title={payerPurpose || undefined}>
        <span className={`block truncate leading-5 font-medium ${resolved ? '' : 'text-slate-800'}`}>{line.payer ?? EM_DASH}</span>
        <span className="block truncate text-[0.75rem] leading-4 text-slate-500">{line.purpose ?? EM_DASH}</span>
      </td>
      <td>
        <span className="block truncate font-mono text-[0.75rem] leading-5">
          {policy ? (
            <Link to={`/policies/${policy.id}?tab=premium`} className="text-accent-600 hover:underline" title={policy.policyholder ?? undefined}>
              {policy.policy_number}
            </Link>
          ) : (
            EM_DASH
          )}
        </span>
        <span className="block truncate text-[0.75rem] leading-4 text-slate-500" title={basis}>
          {basis}
        </span>
      </td>
      {children}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Assign to a policy
// ---------------------------------------------------------------------------

function AssignModal({
  line,
  importId,
  policies,
  onStart,
  onDone,
  onClose,
}: {
  line: BankLine
  importId: string
  policies: readonly PaymentPolicy[]
  /** Called as the assignment is sent: the line keeps its place. */
  onStart: () => void
  onDone: () => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const assign = useAssignBankLine(importId)
  // A payment is recorded in the policy's currency only: offer those.
  const eligible = useMemo(
    () => policies.filter((p) => p.currency_code === line.currency_code),
    [policies, line.currency_code],
  )
  const [policyId, setPolicyId] = useState<string | null>(
    eligible.some((p) => p.id === line.match_policy_id) ? line.match_policy_id : null,
  )
  const chosen = eligible.find((p) => p.id === policyId) ?? null
  const amount = Number(line.amount)
  const overpays = chosen !== null && chosen.outstanding !== null && amount > chosen.outstanding

  const options: ComboOption[] = eligible.map((p) => ({
    id: p.id,
    label: p.policy_number,
    keywords: [p.policyholder],
    meta: (
      <span className="flex justify-between gap-3">
        <span className="truncate">{p.policyholder ?? EM_DASH}</span>
        <span className="shrink-0 tabular-nums">
          {p.outstanding === null
            ? EM_DASH
            : t('premium.bank.assign.owed', { amount: `${formatAmount(p.outstanding, locale)} ${p.currency_code}` })}
        </span>
      </span>
    ),
  }))

  return (
    <Modal
      open
      title={t('premium.bank.assign.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!chosen || overpays || assign.isPending}
            aria-busy={assign.isPending}
            onClick={() => {
              if (!chosen) return
              onStart()
              assign.mutate({ lineId: line.id, policyId: chosen.id }, { onSuccess: onDone })
            }}
          >
            {t('premium.bank.actions.assign')}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.8125rem]">
        <dt className="text-slate-500">{t('premium.bank.fields.value_date')}</dt>
        <dd>{formatDate(line.value_date, locale)}</dd>
        <dt className="text-slate-500">{t('premium.bank.fields.amount')}</dt>
        <dd className="tabular-nums">
          {formatAmount(amount, locale)} {line.currency_code}
        </dd>
        <dt className="text-slate-500">{t('premium.bank.fields.payer')}</dt>
        <dd className="min-w-0 break-words">{line.payer ?? EM_DASH}</dd>
        <dt className="text-slate-500">{t('premium.bank.fields.purpose')}</dt>
        <dd className="min-w-0 break-words">{line.purpose ?? EM_DASH}</dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.75rem] font-semibold tracking-wide text-slate-600 uppercase">
          {t('premium.bank.fields.policy')}
        </span>
        <Combobox
          value={policyId}
          onChange={setPolicyId}
          options={options}
          openOnFocus
          autoFocus
          placeholder={t('premium.bank.assign.search')}
          aria-label={t('premium.bank.fields.policy')}
        />
        <span className="text-xs text-slate-500">
          {chosen
            ? [
                chosen.policyholder,
                chosen.outstanding === null
                  ? null
                  : t('premium.bank.assign.owed', { amount: `${formatAmount(chosen.outstanding, locale)} ${chosen.currency_code}` }),
              ]
                .filter(Boolean)
                .join(' · ')
            : t('premium.bank.assign.currencyHint', { currency: line.currency_code })}
        </span>
      </div>
      {overpays && chosen && (
        <Callout tone="neg" title={t('premium.bank.assign.overpays')}>
          {t('premium.bank.assign.overpaysHint', {
            amount: `${formatAmount(chosen.outstanding, locale)} ${chosen.currency_code}`,
          })}
        </Callout>
      )}
      {assign.isError && (
        <Callout tone="neg" title={t('premium.bank.assign.failed')}>
          {t(refusalKey(assign.error))}
        </Callout>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Set aside
// ---------------------------------------------------------------------------

function IgnoreModal({
  line,
  onSubmit,
  onClose,
}: {
  line: BankLine | null
  onSubmit: (line: BankLine, reason: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const close = () => {
    setReason('')
    onClose()
  }
  return (
    <Modal
      open={line !== null}
      title={t('premium.bank.ignore.title')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              if (!line) return
              onSubmit(line, reason.trim())
              setReason('')
            }}
          >
            {t('premium.bank.actions.ignore')}
          </Button>
        </>
      }
    >
      <p className="text-[0.8125rem] text-slate-600">{t('premium.bank.ignore.hint')}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.75rem] font-semibold tracking-wide text-slate-600 uppercase">
          {t('premium.bank.ignore.reason')}
        </span>
        <Textarea
          value={reason}
          maxLength={500}
          autoFocus
          placeholder={t('premium.bank.ignore.placeholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </Modal>
  )
}
