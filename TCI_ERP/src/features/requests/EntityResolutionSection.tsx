/** Entity resolution: package buyers still entered as a bare name. Each row
 * either picks an existing company (dedup rules already applied in the
 * registry) or creates one inline through the ordinary registry form, which
 * carries the Phase 3a dedup-on-entry checks. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Input, Select } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useEntities } from '../entities/api'
import { EntityFormModal } from '../entities/EntityFormModal'
import { useResolveRequestBuyer } from './api'
import { canResolveBuyers } from './machine'
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
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {t('requests.entityResolution')}
        </h2>
        <Badge tone="warn">{unresolved.length}</Badge>
      </div>
      <p className="mb-3 text-[13px] text-slate-500">{t('requests.entityResolutionHint')}</p>

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
  const { data: entities } = useEntities()
  const resolve = useResolveRequestBuyer(requestId)

  const [search, setSearch] = useState(buyer.proposed_name ?? '')
  const [entityId, setEntityId] = useState(buyer.entity_id ?? '')
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (entities ?? []).filter((e) => !query || e.name.toLowerCase().includes(query))
  }, [entities, search])

  const handleResolve = async () => {
    if (!entityId) return
    setError(null)
    try {
      await resolve.mutateAsync({ buyerRowId: buyer.id, entityId })
    } catch {
      setError(t('requests.resolveFailed'))
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-[13px]">
        <span className="font-medium text-slate-800">
          {buyer.proposed_name ?? t('requests.unnamedBuyer')}
        </span>
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('entities.searchPlaceholder')}
        />
        <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">{t('common.notSelected')}</option>
          {candidates.slice(0, 50).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void handleResolve()}
            disabled={disabled || !entityId || resolve.isPending}
          >
            {t('requests.actions.resolve')}
          </Button>
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
      {error && (
        <p className="mt-1.5 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
      {/* A company created here resolves this buyer straight away - the
          user never leaves the submission. */}
      <EntityFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialName={buyer.proposed_name ?? ''}
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
