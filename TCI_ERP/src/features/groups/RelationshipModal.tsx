/** Recording a corporate relationship by hand.
 *
 * The direction is the human's: the modal names the parent and the child
 * explicitly rather than inferring one from the other. The ownership
 * percentage is only offered on an ownership edge, mirroring the check
 * tci.save_entity_relationship makes.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, DateInput, Field, Input, Modal, Select } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { EntityPicker } from '../entities/EntityPicker'
import { useSaveRelationship } from './api'
import { groupErrorKey } from './errors'
import { RELATIONSHIP_TYPES, type RelationshipType } from './types'

interface RelationshipModalProps {
  open: boolean
  onClose: () => void
  /** The company whose card we are on. It starts as the parent; the direction
   * switch flips it, because half of these edges point the other way. */
  entityId: string
  entityName: string
}

export function RelationshipModal({ open, onClose, entityId, entityName }: RelationshipModalProps) {
  const { t } = useTranslation()
  const save = useSaveRelationship()

  const [otherId, setOtherId] = useState<string | null>(null)
  const [thisIsParent, setThisIsParent] = useState(true)
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('ownership')
  const [ownershipPct, setOwnershipPct] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pctNumber = parseAmount(ownershipPct) ?? Number.NaN
  const pctValid =
    ownershipPct.trim() === '' ||
    (Number.isFinite(pctNumber) && pctNumber > 0 && pctNumber <= 100)
  const valid = Boolean(otherId) && pctValid

  const handleSave = async () => {
    if (!otherId) return
    setError(null)
    try {
      await save.mutateAsync({
        parentEntityId: thisIsParent ? entityId : otherId,
        childEntityId: thisIsParent ? otherId : entityId,
        relationshipType,
        // Only an ownership edge may carry a percentage — the SQL function
        // refuses one anywhere else, so we never send it.
        ownershipPct:
          relationshipType === 'ownership' && ownershipPct.trim() !== '' ? pctNumber : null,
        validFrom,
        sourceNote: note.trim() || null,
      })
      onClose()
    } catch (e) {
      setError(t(groupErrorKey(e) ?? 'groups.errors.saveFailed'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('groups.actions.addRelationship')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!valid}
            loading={save.isPending}
            title={otherId ? undefined : t('groups.errors.counterpartyRequired')}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Two full sentences, both visible: a native select cut them off
            («PAO Ozon Holding — матер…») exactly where the meaning is. */}
        <Field label={t('groups.fields.direction')}>
          <div role="radiogroup" aria-label={t('groups.fields.direction')} data-card-row className="grid gap-2 sm:grid-cols-2">
            {([true, false] as const).map((parent) => {
              const selected = thisIsParent === parent
              return (
                <button
                  key={String(parent)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setThisIsParent(parent)}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-small transition-colors ${
                    selected
                      ? 'border-accent-600 bg-accent-50 text-accent-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 size-3.5 shrink-0 rounded-full border ${
                      selected ? 'border-[4px] border-accent-600 bg-white' : 'border-slate-300 bg-white'
                    }`}
                  />
                  <span>
                    {parent
                      ? t('groups.direction.thisIsParent', { name: entityName })
                      : t('groups.direction.thisIsChild', { name: entityName })}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={t('groups.fields.counterparty')}>
          <EntityPicker value={otherId} onChange={setOtherId} exclude={[entityId]} allowRequest />
        </Field>

        <div className="grid grid-cols-2 gap-3">
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

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('groups.fields.validFrom')}>
            <DateInput value={validFrom} onChange={setValidFrom} />
          </Field>
          <Field label={t('groups.fields.sourceNote')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {!pctValid && (
          <p className="text-small text-neg-500" role="alert">
            {t('groups.errors.pctRange')}
          </p>
        )}
        {error && (
          <p className="text-small text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
