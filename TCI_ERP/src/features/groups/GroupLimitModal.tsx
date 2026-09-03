/** Setting the group limit — the ceiling on everything the group may hold.
 *
 * Immutable like every other limit: a new one CLOSES the previous rather than
 * editing it, so what the ceiling was when a decision was taken stays
 * readable. The band authority is checked by tci.set_group_limit against the
 * ULTIMATE PARENT's assessment, and the refusal is mapped, not swallowed.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { useCurrencies } from '../entities/api'
import { useSetGroupLimit } from './api'
import { groupErrorKey } from './errors'

interface GroupLimitModalProps {
  open: boolean
  onClose: () => void
  ultimateParentId: string
  ultimateParentName: string
  currentAmount?: number | null
  currentCurrency?: string | null
}

export function GroupLimitModal({
  open,
  onClose,
  ultimateParentId,
  ultimateParentName,
  currentAmount,
  currentCurrency,
}: GroupLimitModalProps) {
  const { t } = useTranslation()
  const setLimit = useSetGroupLimit()
  const { data: currencies } = useCurrencies()

  const [amount, setAmount] = useState(currentAmount ? String(currentAmount) : '')
  const [currency, setCurrency] = useState(currentCurrency ?? 'UZS')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsed = Number(amount.replace(/\s/g, '').replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0

  const handleSave = async () => {
    setError(null)
    try {
      await setLimit.mutateAsync({
        ultimateParentId,
        maxAmount: parsed,
        currency,
        validFrom,
        comment: comment.trim() || null,
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
      title={t('groups.actions.setGroupLimit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid || setLimit.isPending}>
            {setLimit.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-slate-500">
          {t('groups.limitModalHint', { name: ultimateParentName })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('groups.fields.maxAmount')}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num"
            />
          </Field>
          <Field label={t('groups.fields.currency')}>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(currencies ?? []).length === 0 && <option value="UZS">UZS</option>}
              {(currencies ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('groups.fields.validFrom')}>
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={t('policies.transitionComment')}>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
