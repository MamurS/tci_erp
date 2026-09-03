/** Recording a corporate relationship by hand.
 *
 * The direction is the human's: the modal names the parent and the child
 * explicitly rather than inferring one from the other. The ownership
 * percentage is only offered on an ownership edge, mirroring the check
 * tci.save_entity_relationship makes.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { useEntities } from '../entities/api'
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
  const { data: entities } = useEntities()

  const [search, setSearch] = useState('')
  const [otherId, setOtherId] = useState('')
  const [thisIsParent, setThisIsParent] = useState(true)
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('ownership')
  const [ownershipPct, setOwnershipPct] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (entities ?? [])
      .filter((e) => e.id !== entityId)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .slice(0, 50)
  }, [entities, entityId, search])

  const pctNumber = Number(ownershipPct.replace(',', '.'))
  const pctValid =
    ownershipPct.trim() === '' ||
    (Number.isFinite(pctNumber) && pctNumber > 0 && pctNumber <= 100)
  const valid = Boolean(otherId) && pctValid

  const handleSave = async () => {
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
          <Button onClick={() => void handleSave()} disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('groups.fields.direction')}>
          <Select
            value={thisIsParent ? 'parent' : 'child'}
            onChange={(e) => setThisIsParent(e.target.value === 'parent')}
          >
            <option value="parent">{t('groups.direction.thisIsParent', { name: entityName })}</option>
            <option value="child">{t('groups.direction.thisIsChild', { name: entityName })}</option>
          </Select>
        </Field>

        <Field label={t('groups.fields.counterparty')}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('buyers.searchPlaceholder')}
          />
          <Select
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            className="mt-1.5"
            size={Math.min(6, Math.max(3, candidates.length))}
          >
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.registration_number ? ` · ${e.registration_number}` : ''}
              </option>
            ))}
          </Select>
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
              <Input
                inputMode="decimal"
                value={ownershipPct}
                onChange={(e) => setOwnershipPct(e.target.value)}
                className="num"
              />
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('groups.fields.validFrom')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t('groups.fields.sourceNote')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {!pctValid && (
          <p className="text-[13px] text-neg-500" role="alert">
            {t('groups.errors.pctRange')}
          </p>
        )}
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
