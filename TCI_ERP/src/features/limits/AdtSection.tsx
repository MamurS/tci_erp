/**
 * «Порог автоматических решений (ADT)» on the buyer card (migration 0061):
 * the global switch, the buyer's live ADT (amount, used / total, what is
 * left, the band it was set at, suspended and why), the manual ban, and every
 * ADT the buyer ever had. Credit underwriting sets, replaces and disables it
 * and bans auto decisions (`canSetAdt`); admin reads the block without the
 * actions (since 0063 admin decides nothing); nobody else sees the block or
 * even asks for it (`canSeeAdt`) — the database would refuse them.
 *
 * Every rule is the database's: the set form only HINTS at the authority
 * test of tci.set_buyer_adt, and each refusal comes back named (refusals.ts).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  DescriptionList,
  EmptyState,
  Field,
  KeyFigures,
  labelCol,
  Modal,
  SectionTitle,
  Select,
  Skeleton,
  Table,
  Textarea,
} from '../../components/ui'
import { amountToPlain, parseAmount } from '../../components/ui/amount'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatAmount, formatDate, formatMoment } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import { bandForGrade } from '../../lib/roles'
import { DEEP_LINK_SCROLL_MARGIN } from '../../lib/useDeepLinkFocus'
import { useCurrencies } from '../entities/api'
import { useAssessments } from '../entities/rating/assessmentsApi'
import {
  ADT_COUNT_BOUNDS,
  ADT_FOCUS,
  adtFormValid,
  adtStatusTone,
  adtWithinAuthority,
  banNeedsReason,
  canSeeAdt,
  canSetAdt,
  isKnownReason,
} from './adt'
import type { AdtLive, AdtState } from './adt'
import { useBuyerAdtState, useDisableBuyerAdt, useSetBuyerAdt, useSetBuyerAdtBlock } from './adtApi'
import { useLatestRatesFor, useMyAuthorityUzs } from './api'
import { toUzs } from './authority'

const HISTORY_COLUMNS = [COL.date, COL.money, COL.count, labelCol('limitBand'), labelCol('adtStatus'), COL.fill, COL.date]

type Dialog = 'set' | 'disable' | 'ban' | 'unban' | null

/** The block, or nothing for anyone outside the credit desk. */
export function AdtSection({ entityId }: { entityId: string }) {
  const { roles } = useAuth()
  if (!canSeeAdt(roles)) return null
  return (
    <div id={ADT_FOCUS} className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
      <AdtCard entityId={entityId} canAct={canSetAdt(roles)} />
    </div>
  )
}

function AdtCard({ entityId, canAct }: { entityId: string; canAct: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: state, isLoading, isError } = useBuyerAdtState(entityId, true)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)

  const live = state?.live ?? null
  const banned = state?.block?.blocked === true

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={t('limits.adt.hint')}
        actions={
          state && canAct ? (
            <>
              <Button size="sm" onClick={() => setDialog('set')}>
                {t(live ? 'limits.adt.actions.replace' : 'limits.adt.actions.set')}
              </Button>
              {live && (
                <Button size="sm" variant="secondary" onClick={() => setDialog('disable')}>
                  {t('limits.adt.actions.disable')}
                </Button>
              )}
              <Button size="sm" variant={banned ? 'secondary' : 'dangerOutline'} onClick={() => setDialog(banned ? 'unban' : 'ban')}>
                {t(banned ? 'limits.adt.actions.unban' : 'limits.adt.actions.ban')}
              </Button>
            </>
          ) : undefined
        }
      >
        {t('limits.adt.title')}
      </SectionTitle>

      {error && <Callout tone="neg" title={error} />}

      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <Callout tone="neg" title={t('limits.adt.loadFailed')} />
      ) : (
        <AdtBody state={state ?? EMPTY_STATE} locale={locale} />
      )}

      {dialog === 'set' && (
        <SetAdtModal entityId={entityId} live={live} onClose={() => setDialog(null)} />
      )}
      {dialog === 'disable' && (
        <DisableAdtModal entityId={entityId} onClose={() => setDialog(null)} onError={setError} />
      )}
      {(dialog === 'ban' || dialog === 'unban') && (
        <BanModal entityId={entityId} ban={dialog === 'ban'} onClose={() => setDialog(null)} onError={setError} />
      )}
    </Card>
  )
}

/** What the screen shows when the function answered nothing usable. */
const EMPTY_STATE: AdtState = { enabled: false, live: null, block: null, history: [] }

function AdtBody({ state, locale }: { state: AdtState; locale: string }) {
  const { t } = useTranslation()
  const live = state.live
  const reason = (key: string | null) => (isKnownReason(key) ? t(`limits.auto.reasons.${key}`) : EM_DASH)

  return (
    <>
      {!state.enabled && (
        <Callout tone="warn" title={t('limits.adt.switchedOffTitle')}>
          {t('limits.adt.switchedOffBody')}
        </Callout>
      )}

      {state.block?.blocked && (
        <Callout tone="warn" title={t('limits.adt.bannedTitle')}>
          {t('limits.adt.bannedBody', {
            reason: state.block.reason ?? EM_DASH,
            name: state.block.set_by_name ?? EM_DASH,
            date: formatMoment(state.block.set_at, locale),
          })}
        </Callout>
      )}

      {live ? (
        <LiveAdt live={live} locale={locale} reason={reason} />
      ) : (
        <EmptyState title={t('limits.adt.none')} hint={t('limits.adt.noneHint')} />
      )}

      <div>
        <h3 className="mb-2 text-small font-semibold text-slate-700">{t('limits.adt.history')}</h3>
        {state.history.length === 0 ? (
          <p className="text-small text-slate-500">{t('limits.adt.historyEmpty')}</p>
        ) : (
          <Table dense columns={HISTORY_COLUMNS}>
            <thead>
              <tr>
                <th>{t('limits.adt.fields.setAt')}</th>
                <th className="num">{t('limits.adt.fields.maxAmount')}</th>
                <th className="num">{t('limits.adt.fields.used')}</th>
                <th>{t('limits.adt.fields.band')}</th>
                <th>{t('limits.adt.fields.status')}</th>
                <th>{t('limits.adt.fields.setBy')}</th>
                <th>{t('limits.adt.fields.ended')}</th>
              </tr>
            </thead>
            <tbody>
              {state.history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.set_at, locale)}</td>
                  <td className="num">
                    {formatAmount(h.max_amount, locale)} {h.currency}
                  </td>
                  <td className="num">{t('limits.adt.usedOf', { used: h.used, total: h.total })}</td>
                  <td>
                    <Badge tone="neutral">{t(`limits.bands.${h.grade_band}`)}</Badge>
                  </td>
                  <td>
                    <span title={h.suspended_reason ? reason(h.suspended_reason) : undefined}>
                      <Badge tone={adtStatusTone(h.status)}>{t(`limits.adt.statuses.${h.status}`)}</Badge>
                    </span>
                  </td>
                  <td title={h.comment ?? undefined}>{h.set_by_name ?? EM_DASH}</td>
                  <td>{h.ended_at ? formatDate(h.ended_at, locale) : EM_DASH}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  )
}

function LiveAdt({ live, locale, reason }: { live: AdtLive; locale: string; reason: (key: string | null) => string }) {
  const { t } = useTranslation()
  return (
    <>
      {live.status === 'suspended' && (
        <Callout tone="warn" title={t('limits.adt.suspendedTitle', { reason: reason(live.suspended_reason) })}>
          {t('limits.adt.suspendedBody', {
            date: live.suspended_at ? formatMoment(live.suspended_at, locale) : EM_DASH,
          })}
        </Callout>
      )}
      <KeyFigures
        className=""
        items={[
          { label: t('limits.adt.fields.maxAmount'), value: `${formatAmount(live.max_amount, locale)} ${live.currency}` },
          { label: t('limits.adt.fields.used'), value: t('limits.adt.usedOf', { used: live.used, total: live.total }) },
          {
            label: t('limits.adt.fields.remaining'),
            value: formatAmount(live.remaining, locale),
            tone: live.remaining <= 0 ? 'warn' : 'default',
          },
          { label: t('limits.adt.fields.band'), value: t(`limits.bands.${live.grade_band}`), text: true },
        ]}
      />
      <DescriptionList
        columns={2}
        items={[
          {
            label: t('limits.adt.fields.status'),
            value: <Badge tone={adtStatusTone(live.status)}>{t(`limits.adt.statuses.${live.status}`)}</Badge>,
          },
          {
            label: t('limits.adt.fields.setBy'),
            value: `${live.set_by_name ?? EM_DASH} · ${formatMoment(live.set_at, locale)}`,
          },
          { label: t('limits.adt.fields.comment'), value: live.comment || EM_DASH },
        ]}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function SetAdtModal({ entityId, live, onClose }: { entityId: string; live: AdtLive | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const assessments = useAssessments(entityId)
  const latest = assessments.data?.[0] ?? null
  const band = bandForGrade(latest?.rating_grade)
  const { data: currencies } = useCurrencies()
  const { data: authority } = useMyAuthorityUzs(band)

  const [amount, setAmount] = useState(live ? amountToPlain(live.max_amount) : '')
  const [currency, setCurrency] = useState(live?.currency ?? latest?.limit_currency ?? 'UZS')
  const [count, setCount] = useState(live ? String(live.total) : '')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useSetBuyerAdt()
  const { data: rates } = useLatestRatesFor(currency)

  const parsedAmount = parseAmount(amount)
  const parsedCount = parseAmount(count)
  const valid = adtFormValid({ amount: parsedAmount, count: parsedCount, currency })
  const todayIso = new Date().toISOString().slice(0, 10)
  const amountUzs = parsedAmount === null ? null : toUzs(parsedAmount, currency, rates ?? [], todayIso)
  const within = adtWithinAuthority({ amountUzs, authorityUzs: authority ?? null })
  const bandLabel = t(`limits.bands.${band}`)

  const submit = async () => {
    if (!valid || parsedAmount === null || parsedCount === null) return
    setError(null)
    try {
      await save.mutateAsync({
        entityId,
        maxAmount: parsedAmount,
        currency,
        totalCount: parsedCount,
        comment: comment.trim() || null,
      })
      onClose()
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.adt.errors.saveFailed')))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(live ? 'limits.adt.replaceTitle' : 'limits.adt.setTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || !latest} loading={save.isPending}>
            {t(live ? 'limits.adt.actions.replace' : 'limits.adt.actions.set')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-small leading-relaxed text-slate-600">{t('limits.adt.setHint')}</p>
        {assessments.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : latest ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-small text-slate-700">
            <p>{t('limits.adt.latestRating', { grade: latest.rating_grade, band: bandLabel })}</p>
            <p className="mt-0.5 tabular-nums">
              {t('limits.adt.recommended', {
                amount: `${formatAmount(Number(latest.suggested_limit), locale)} ${latest.limit_currency}`,
              })}
            </p>
          </div>
        ) : (
          <Callout tone="neg" title={t('limits.adt.errors.noRating')} />
        )}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label={t('limits.adt.fields.maxAmount')}>
            <AmountInput value={amount} onChange={setAmount} suffix={currency} />
          </Field>
          <Field label={t('limits.adt.fields.currency')}>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(currencies?.map((c) => c.code) ?? [currency]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={t('limits.adt.fields.count')}
          hint={t('limits.adt.countHint', { min: ADT_COUNT_BOUNDS.min, max: ADT_COUNT_BOUNDS.max })}
        >
          <AmountInput decimals={0} value={count} onChange={setCount} />
        </Field>

        {latest && (
          <p className="text-small text-slate-500 tabular-nums">
            {t('limits.adt.authorityIn', {
              band: bandLabel,
              amount: authority === undefined ? EM_DASH : `${formatAmount(authority, locale)} UZS`,
            })}
          </p>
        )}
        {latest && within === false && (
          <Callout tone="warn" title={t('limits.adt.beyondAuthority', { band: bandLabel })} />
        )}
        {latest && parsedAmount !== null && currency !== 'UZS' && amountUzs === null && rates && (
          <Callout tone="warn" title={t('limits.adt.noRate', { currency })} />
        )}

        <Field label={t('limits.adt.fields.comment')} hint={t('limits.adt.commentHint')}>
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}

function DisableAdtModal({
  entityId,
  onClose,
  onError,
}: {
  entityId: string
  onClose: () => void
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const disable = useDisableBuyerAdt()
  const [comment, setComment] = useState('')

  const confirm = () => {
    onError(null)
    // Optimistic: the block shows the ADT gone at once; a refusal restores it.
    disable.mutate(
      { entityId, comment: comment.trim() || null },
      { onError: (failure) => onError(t(refusalOr(failure, 'limits.adt.errors.saveFailed'))) },
    )
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('limits.adt.disableTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {t('limits.adt.actions.disable')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-body leading-relaxed text-slate-600">{t('limits.adt.disableConfirm')}</p>
        <Field label={t('limits.adt.fields.comment')} hint={t('limits.adt.commentHint')}>
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function BanModal({
  entityId,
  ban,
  onClose,
  onError,
}: {
  entityId: string
  ban: boolean
  onClose: () => void
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const block = useSetBuyerAdtBlock()
  const [reason, setReason] = useState('')
  const missing = banNeedsReason(ban, reason)

  const confirm = () => {
    if (missing) return
    onError(null)
    block.mutate(
      { entityId, blocked: ban, reason: reason.trim() || null },
      { onError: (failure) => onError(t(refusalOr(failure, 'limits.adt.errors.saveFailed'))) },
    )
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(ban ? 'limits.adt.banTitle' : 'limits.adt.unbanTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={ban ? 'danger' : 'primary'} onClick={confirm} disabled={missing}>
            {t(ban ? 'limits.adt.actions.ban' : 'limits.adt.actions.unban')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-body leading-relaxed text-slate-600">
          {t(ban ? 'limits.adt.banHint' : 'limits.adt.unbanConfirm')}
        </p>
        <Field
          label={t(ban ? 'limits.adt.fields.banReason' : 'limits.adt.fields.comment')}
          hint={ban ? t('limits.adt.banReasonHint') : t('limits.adt.commentHint')}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
