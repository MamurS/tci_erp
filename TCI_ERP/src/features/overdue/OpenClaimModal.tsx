/** «Open a claim» from an overdue notification, by staff on the
 * policyholder's behalf. The policy, the buyer and the notification are what
 * the claim is opened ON, so they are shown, not chosen; only the cause of
 * loss is a decision. It opens a DRAFT — invoices, documents and filing
 * happen on the claim page, where this lands. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Callout, DescriptionList, Field, Input, Modal, Select } from '../../components/ui'
import { formatAmount, formatDate } from '../../lib/format'
import { useOpenClaim } from '../claims/api'
import { CAUSES_OF_LOSS } from '../claims/types'
import type { CauseOfLoss } from '../claims/types'
import { openClaimErrorKey } from './openClaim'
import type { OverdueNotification } from './types'

export function OpenClaimModal({ noa, onClose }: { noa: OverdueNotification; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const openClaim = useOpenClaim()
  const [cause, setCause] = useState<CauseOfLoss>('protracted_default')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    openClaim
      .mutateAsync({
        policy_id: noa.policy_id,
        entity_id: noa.buyer_entity_id,
        cause_of_loss: cause,
        overdue_notification_id: noa.id,
        // Only an insolvency has a case to refer to.
        insolvency_reference: cause === 'insolvency' ? reference.trim() || null : null,
      })
      .then((claim) => void navigate(`/claims/${claim.id}`))
      .catch((e: unknown) => setError(t(openClaimErrorKey(e))))
  }

  return (
    <Modal
      open
      title={t('claims.actions.open')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={openClaim.isPending} onClick={submit}>
            {t('claims.actions.open')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <DescriptionList
        items={[
          { label: t('claims.fields.policy'), value: noa.policy_number },
          { label: t('claims.fields.policyholder'), value: noa.policyholder_name },
          { label: t('claims.fields.buyer'), value: noa.buyer_name },
          {
            label: t('overdues.eyebrow'),
            hint: `${t('overdues.fields.reported')} ${formatDate(noa.reported_at, locale)}`,
            value: `${formatAmount(Number(noa.overdue_amount), locale)} ${noa.currency_code}`,
          },
        ]}
      />
      <p className="text-[0.8125rem] leading-relaxed text-slate-600">{t('overdues.openClaim.hint')}</p>
      <Field label={t('claims.fields.cause')}>
        <Select value={cause} onChange={(e) => setCause(e.target.value as CauseOfLoss)}>
          {CAUSES_OF_LOSS.map((c) => (
            <option key={c} value={c}>
              {t(`claims.causes.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      {cause === 'insolvency' && (
        <Field label={t('claims.fields.insolvencyReference')} hint={t('overdues.openClaim.referenceHint')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}
