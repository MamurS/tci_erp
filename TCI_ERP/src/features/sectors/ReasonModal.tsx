/**
 * A decision that needs a reason the other person will read (reject a
 * review, reject or end an internal country category): one text field,
 * checked when left and on sending, the button named for the outcome, the
 * database's refusal shown in words.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Modal, Textarea } from '../../components/ui'
import { refusalKey } from '../../lib/refusals'

export function ReasonModal({
  title,
  intro,
  label,
  hint,
  missingMessage,
  submitLabel,
  pending,
  onSubmit,
  onClose,
}: {
  title: string
  intro?: ReactNode
  label: string
  hint?: string
  /** Said under the field when it is left empty. */
  missingMessage: string
  submitLabel: string
  pending: boolean
  onSubmit: (reason: string) => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [left, setLeft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const missing = !reason.trim()

  const send = () => {
    setLeft(true)
    setError(null)
    if (missing) return
    onSubmit(reason.trim())
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={pending} onClick={send}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      {intro && <div className="text-small text-slate-600">{intro}</div>}
      <Field label={label} hint={hint} error={left && missing ? missingMessage : null}>
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setLeft(true)} />
      </Field>
    </Modal>
  )
}
