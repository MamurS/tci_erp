/** Sales panel, shown while a submission sits in sales_confirmation: every
 * limit decision of the package with its release state, and the only two
 * levers sales have — CONFIRM NOW (the client sees it at once) and HOLD &
 * DISCUSS (suspends the silent-consent clock). Sales can never change a
 * term; the SQL grants make that structural. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Field, Input, SectionTitle, Truncate } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../lib/roles'
import { EM_DASH, formatAmount } from '../../lib/format'
import { useEntities } from '../entities/api'
import { ReleaseBadge } from '../limits/ReleaseBadge'
import {
  useEffectiveLimits,
  useHoldDecision,
  useReleaseDecision,
  useSalesWindowHours,
} from '../limits/api'
import { canHold, canRelease } from '../limits/release'
import type { EffectiveLimit } from '../limits/types'
import type { InsuranceRequestWithRefs } from './types'

export function SalesWindowPanel({ request }: { request: InsuranceRequestWithRefs }) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const { data: limits } = useEffectiveLimits({ insuranceRequestId: request.id })
  const { data: windowHours } = useSalesWindowHours()
  const { data: entities } = useEntities()
  const nameOf = (id: string) => entities?.find((e) => e.id === id)?.name ?? EM_DASH

  const mayAct = hasRole(roles, 'sales')
  const pending = (limits ?? []).filter((l) => !l.client_visible)

  return (
    <Card className="border-accent-600/30 p-5">
      <SectionTitle
        className="mb-3"
        hint={t('requests.salesPanelHint')}
        actions={<Badge tone="accent">{t('requests.windowHours', { hours: windowHours ?? 24 })}</Badge>}
      >
        {t('requests.salesPanel')}
      </SectionTitle>

      {!limits?.length ? (
        <p className="text-small text-slate-500">{t('requests.noDecisionsYet')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {limits.map((limit) => (
            <DecisionRow
              key={limit.decision_id}
              buyerName={nameOf(limit.entity_id)}
              limit={limit}
              salesWindowHours={windowHours ?? 24}
              mayAct={mayAct}
            />
          ))}
        </div>
      )}

      {pending.length === 0 && limits?.length ? (
        <p className="mt-2 text-caption text-pos-500">{t('requests.allReleased')}</p>
      ) : null}
    </Card>
  )
}

function DecisionRow({
  buyerName,
  limit,
  salesWindowHours,
  mayAct,
}: {
  buyerName: string
  limit: EffectiveLimit
  salesWindowHours: number
  mayAct: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const release = useReleaseDecision()
  const hold = useHoldDecision()

  const [holdOpen, setHoldOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nowIso = new Date().toISOString()

  const run = async (action: Promise<unknown>) => {
    setError(null)
    try {
      await action
      setHoldOpen(false)
      setComment('')
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.release.actionFailed')))
    }
  }

  return (
    // The id is what `?focus=sales-window&decision=<id>` rings.
    <div id={`decision-${limit.decision_id}`} className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Whose limit it is — an amount alone says nothing to sales. */}
        <Truncate text={buyerName} className="max-w-[16rem] text-small font-medium text-slate-800">
          {buyerName}
        </Truncate>
        <span className="num text-small font-semibold text-slate-800">
          {limit.approved_amount !== null
            ? `${formatAmount(Number(limit.approved_amount), locale)} ${limit.currency_code}`
            : EM_DASH}
        </span>
        {limit.commercially_adjusted && (
          <span className="num text-caption text-slate-500">
            {t('limits.stagePair', {
              credit: formatAmount(Number(limit.credit_amount), locale),
              commercial: formatAmount(Number(limit.approved_amount), locale),
            })}
          </span>
        )}
        <ReleaseBadge facts={limit} salesWindowHours={salesWindowHours} nowIso={nowIso} />

        {mayAct && (
          <span className="ml-auto flex gap-2">
            {canRelease(limit) && (
              <Button
                size="sm"
                loading={release.isPending}
                onClick={() => void run(release.mutateAsync({ decisionId: limit.decision_id }))}
              >
                {t('limits.release.confirmNow')}
              </Button>
            )}
            {canHold(limit) && !holdOpen && (
              <Button size="sm" variant="secondary" onClick={() => setHoldOpen(true)}>
                {t('limits.release.holdAndDiscuss')}
              </Button>
            )}
          </span>
        )}
      </div>

      {holdOpen && (
        <div className="mt-2 flex items-end gap-2">
          <Field label={t('limits.release.holdComment')} className="flex-1">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('limits.release.holdCommentPlaceholder')}
            />
          </Field>
          <Button
            size="sm"
            variant="danger"
            disabled={!comment.trim()}
            loading={hold.isPending}
            onClick={() =>
              void run(
                hold.mutateAsync({ decisionId: limit.decision_id, comment: comment.trim() }),
              )
            }
          >
            {t('limits.release.holdAndDiscuss')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHoldOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
