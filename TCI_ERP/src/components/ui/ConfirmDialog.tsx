/**
 * «Are you sure?» in the application's own look — never the browser's
 * confirm(), which cannot be styled or translated and freezes the page.
 * The confirming button names the action ("Revoke sessions"), never "OK".
 */

import { useTranslation } from 'react-i18next'

import { Button, Modal } from './primitives'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  /** The action itself, e.g. «Завершить сеансы». */
  confirmLabel: string
  /** danger: irreversible or destructive. */
  tone?: 'danger' | 'primary'
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-slate-600">{message}</p>
    </Modal>
  )
}
