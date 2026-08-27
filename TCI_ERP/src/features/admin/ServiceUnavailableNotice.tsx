/** Shown wherever provisioning is offered but the service is not running.
 * Same pattern as the Rating tab: name the cause, do not pretend the button
 * would work. */

import { useTranslation } from 'react-i18next'

import { Card } from '../../components/ui'

export function ServiceUnavailableNotice() {
  const { t } = useTranslation()
  return (
    <Card className="border-warn-500/30 bg-warn-50 p-4 text-[13px] text-warn-500">
      <p className="font-medium">{t('provisioning.serviceUnavailable')}</p>
      <p className="mt-0.5">{t('provisioning.serviceUnavailableHint')}</p>
    </Card>
  )
}
