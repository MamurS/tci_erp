/** Entity resolution: package buyers still entered as a bare name. Each row
 * either picks an existing company (dedup rules already applied in the
 * registry) or creates one inline through the ordinary registry form, which
 * carries the Phase 3a dedup-on-entry checks. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, SectionTitle } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useEntities } from '../entities/api'
import { EntityPicker } from '../entities/EntityPicker'
import { EntityFormModal } from '../entities/EntityFormModal'
import { useResolveRequestBuyer } from './api'
import { canResolveBuyers } from './machine'
import { resolutionSeed } from './resolutionSeed'
import type { InsuranceRequestWithRefs, RequestBuyerWithRefs } from './types'

export function EntityResolutionSection({
  request,
  buyers,
}: {
  request: InsuranceRequestWithRefs
  buyers: readonly RequestBuyerWithRefs[]
}) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const unresolved = buyers.filter(
    (b) => b.entity_id === null || b.resolution_status === 'pending_entity',
  )

  // Once everything is resolved the section has nothing to say.
  if (!unresolved.length) return null

  return (
    <Card className="border-warn-500/30 p-5">
      <SectionTitle
        className="mb-3"
        hint={t('requests.entityResolutionHint')}
        actions={<Badge tone="warn">{unresolved.length}</Badge>}
      >
        {t('requests.entityResolution')}
      </SectionTitle>

      <div className="flex flex-col gap-2">
        {unresolved.map((buyer) => (
          <ResolveRow
            key={buyer.id}
            requestId={request.id}
            buyer={buyer}
            disabled={!canResolveBuyers(roles)}
          />
        ))}
      </div>
    </Card>
  )
}

function ResolveRow({
  requestId,
  buyer,
  disabled,
}: {
  requestId: string
  buyer: RequestBuyerWithRefs
  disabled: boolean
}) {
  const { t } = useTranslation()
  const resolve = useResolveRequestBuyer(requestId)
  const { data: entities } = useEntities()
  // Focusing the picker searches for the given name, trimmed of its legal
  // form until the registry finds something (resolutionSeed.ts).
  const seed = useMemo(
    () => resolutionSeed(buyer.proposed_name, (entities ?? []).map((e) => e.name)),
    [buyer.proposed_name, entities],
  )

  const [entityId, setEntityId] = useState<string | null>(buyer.entity_id)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResolve = async () => {
    if (!entityId) return
    setError(null)
    try {
      await resolve.mutateAsync({ buyerRowId: buyer.id, entityId })
    } catch {
      setError(t('requests.resolveFailed'))
    }
  }

  // Why «Связать» cannot be pressed yet, said under the row and on hover.
  const blockedReason = disabled
    ? t('requests.resolve.notAllowed')
    : !entityId
      ? t('requests.resolve.pickFirst')
      : null

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-[0.8125rem]">
        <span className="font-medium text-slate-800">
          {buyer.proposed_name ?? t('requests.unnamedBuyer')}
        </span>
      </p>
      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,32rem)_auto]">
        <EntityPicker
          value={entityId}
          onChange={setEntityId}
          seedQuery={seed}
          requestName={buyer.proposed_name ?? undefined}
          allowRequest
          disabled={disabled}
          aria-label={t('requests.resolve.pickerLabel', { name: buyer.proposed_name ?? '' })}
        />
        <div className="flex gap-2">
          <span title={blockedReason ?? undefined} className="inline-flex">
            <Button
              size="sm"
              onClick={() => void handleResolve()}
              disabled={disabled || !entityId}
              loading={resolve.isPending}
            >
              {t('requests.actions.resolve')}
            </Button>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreateOpen(true)}
            disabled={disabled}
          >
            {t('requests.actions.createCompany')}
          </Button>
        </div>
      </div>
      {blockedReason && <p className="mt-1.5 text-[0.75rem] text-slate-500">{blockedReason}</p>}
      {error && (
        <p className="mt-1.5 text-[0.8125rem] text-neg-500" role="alert">
          {error}
        </p>
      )}
      {/* A company created here resolves this buyer straight away - the
          user never leaves the submission. */}
      <EntityFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        prefill={{ name: buyer.proposed_name ?? '' }}
        onCreated={(entity) => {
          setEntityId(entity.id)
          void resolve
            .mutateAsync({ buyerRowId: buyer.id, entityId: entity.id })
            .catch(() => setError(t('requests.resolveFailed')))
        }}
      />
    </div>
  )
}
