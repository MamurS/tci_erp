/** «Возможные связи» — hints, never edges.
 *
 * A suggestion is a shared corporate email domain, an address, a contact
 * person, a similar name or a registration prefix. None of that is evidence of
 * ownership, so nothing here creates a relationship on its own: accepting
 * opens a small form where a human states the DIRECTION and the TYPE, and the
 * edge that results is stamped `suggested_accepted` so the provenance
 * survives.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AmountInput, Badge, Button, Card, ConfirmDialog, Field, Select, SectionTitle, Skeleton } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { useAcceptSuggestion, useRejectSuggestion } from './api'
import { groupErrorKey } from './errors'
import { sortedSignals } from './group'
import { RELATIONSHIP_TYPES, type RelationshipSuggestion, type RelationshipType } from './types'

interface SuggestionsPanelProps {
  entityId: string
  suggestions: RelationshipSuggestion[]
  isLoading: boolean
  mayEdit: boolean
}

export function SuggestionsPanel({
  entityId,
  suggestions,
  isLoading,
  mayEdit,
}: SuggestionsPanelProps) {
  const { t } = useTranslation()
  // Held here, not on the row: an accepted or rejected hint leaves the list
  // at once (optimistic), so a refusal must be said where it outlives it.
  const [error, setError] = useState<string | null>(null)

  return (
    <Card className="flex flex-col gap-3 p-5">
      <SectionTitle hint={t('groups.suggestions.hint')}>{t('groups.suggestions.title')}</SectionTitle>
      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : suggestions.length === 0 ? (
        <p className="text-[13px] text-slate-500">{t('groups.suggestions.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <SuggestionRow key={s.id} entityId={entityId} suggestion={s} mayEdit={mayEdit} setError={setError} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function SuggestionRow({
  entityId,
  suggestion,
  mayEdit,
  setError,
}: {
  entityId: string
  suggestion: RelationshipSuggestion
  mayEdit: boolean
  setError: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const accept = useAcceptSuggestion()
  const reject = useRejectSuggestion()

  const [open, setOpen] = useState(false)
  // Dismissing is remembered: the pair is never proposed again, so it is
  // confirmed first.
  const [confirmReject, setConfirmReject] = useState(false)
  const [thisIsParent, setThisIsParent] = useState(true)
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('ownership')
  const [ownershipPct, setOwnershipPct] = useState('')
  const otherId = suggestion.entity_a === entityId ? suggestion.entity_b : suggestion.entity_a
  const otherName =
    suggestion.entity_a === entityId ? suggestion.entity_b_name : suggestion.entity_a_name
  const signals = sortedSignals(suggestion)
  const pct = parseAmount(ownershipPct) ?? Number.NaN

  const handleAccept = async () => {
    setError(null)
    try {
      await accept.mutateAsync({
        suggestionId: suggestion.id,
        parentEntityId: thisIsParent ? entityId : otherId,
        relationshipType,
        ownershipPct:
          relationshipType === 'ownership' && ownershipPct.trim() !== '' && Number.isFinite(pct)
            ? pct
            : null,
      })
    } catch (e) {
      setError(t(groupErrorKey(e) ?? 'groups.errors.saveFailed'))
    }
  }

  const handleReject = async () => {
    setError(null)
    setConfirmReject(false)
    try {
      await reject.mutateAsync({ suggestionId: suggestion.id })
    } catch (e) {
      setError(t(groupErrorKey(e) ?? 'groups.errors.saveFailed'))
    }
  }

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/entities/${otherId}`} className="text-sm font-medium text-accent-700 hover:underline">
          {otherName}
        </Link>
        <Badge tone="neutral">
          {t('groups.suggestions.score', { score: Number(suggestion.score).toFixed(2) })}
        </Badge>
      </div>

      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {signals.map((sig) => (
          <li
            key={sig.signal}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600"
            title={sig.value}
          >
            {t(`groups.signals.${sig.signal}`)}
          </li>
        ))}
      </ul>

      {mayEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!open ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {t('groups.suggestions.accept')}
              </Button>
              <Button
                size="sm"
                variant="dangerOutline"
                onClick={() => setConfirmReject(true)}
                loading={reject.isPending}
              >
                {t('groups.suggestions.reject')}
              </Button>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2 rounded-md bg-slate-50 p-3">
              <p className="text-[12px] text-slate-500">{t('groups.suggestions.confirmHint')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={t('groups.fields.direction')}>
                  <Select
                    value={thisIsParent ? 'parent' : 'child'}
                    onChange={(e) => setThisIsParent(e.target.value === 'parent')}
                  >
                    <option value="parent">{t('groups.direction.thisOwnsOther')}</option>
                    <option value="child">{t('groups.direction.otherOwnsThis')}</option>
                  </Select>
                </Field>
                <Field label={t('groups.fields.relationshipType')}>
                  <Select
                    value={relationshipType}
                    onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
                  >
                    {RELATIONSHIP_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {t(`groups.relationshipTypes.${rt}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {relationshipType === 'ownership' && (
                  <Field label={t('groups.fields.ownershipPct')}>
                    <AmountInput value={ownershipPct} onChange={setOwnershipPct} suffix="%" />
                  </Field>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleAccept()} loading={accept.isPending}>
                  {t('groups.suggestions.createEdge')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmReject}
        title={t('groups.suggestions.rejectTitle')}
        message={t('groups.suggestions.rejectMessage', { name: otherName })}
        confirmLabel={t('groups.suggestions.reject')}
        pending={reject.isPending}
        onConfirm={() => void handleReject()}
        onCancel={() => setConfirmReject(false)}
      />
    </li>
  )
}
