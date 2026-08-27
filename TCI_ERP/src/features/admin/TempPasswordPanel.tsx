/** The one-time credentials panel.
 *
 * Shown after a user is created or their password is reset. This is the
 * ONLY moment the temporary password exists outside the auth system — it is
 * not stored in our tables and cannot be retrieved again, so the panel says
 * so plainly and offers a copy button rather than inviting a retype.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '../../components/ui'
import type { ProvisionedUser } from '../../lib/provisioning'

export function TempPasswordPanel({
  user,
  onDismiss,
}: {
  user: ProvisionedUser
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'none' | 'ok' | 'failed'>('none')

  const block = `${user.email}\n${user.temporary_password}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block)
      setCopied('ok')
    } catch {
      // Clipboard access can be denied; the value is on screen either way.
      setCopied('failed')
    }
  }

  return (
    <Card className="border-pos-500/40 bg-pos-50/40 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('provisioning.credentials')}</h3>
      <p className="mt-0.5 text-[13px] text-warn-500">{t('provisioning.shownOnce')}</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-500">{t('provisioning.fields.email')}</dt>
        <dd className="font-medium text-slate-900">{user.email}</dd>
        <dt className="text-slate-500">{t('provisioning.fields.tempPassword')}</dt>
        <dd className="num font-semibold break-all text-slate-900">{user.temporary_password}</dd>
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void copy()}>
          {t('provisioning.copy')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          {t('provisioning.done')}
        </Button>
        {copied === 'ok' && (
          <span className="text-xs text-pos-500" role="status">
            {t('provisioning.copied')}
          </span>
        )}
        {copied === 'failed' && (
          <span className="text-xs text-warn-500" role="status">
            {t('provisioning.copyFailed')}
          </span>
        )}
      </div>
    </Card>
  )
}
