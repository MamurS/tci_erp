/** Risk Report generation modal (language / report type / currency picker).
 * Opened from the Rating tab and the buyer dashboard. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Modal, Segmented } from '../../../components/ui'

export function ReportModal({
  open,
  onClose,
  buyerId,
}: {
  open: boolean
  onClose: () => void
  buyerId: string
}) {
  const { t } = useTranslation()
  const [lang, setLang] = useState('ru')
  const [reportType, setReportType] = useState('statutory')
  const [currency, setCurrency] = useState('original')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('rating.reportModal.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              window.open(
                `/buyers/${buyerId}/report?lang=${lang}&type=${reportType}&ccy=${currency}`,
                '_blank',
              )
              onClose()
            }}
          >
            {t('rating.reportModal.open')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-600">
            {t('rating.reportModal.language')}
          </span>
          <Segmented
            value={lang}
            options={[
              { key: 'en', label: 'EN' },
              { key: 'ru', label: 'RU' },
              { key: 'uz', label: 'UZ' },
            ]}
            onChange={setLang}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-600">
            {t('rating.reportModal.reportType')}
          </span>
          <Segmented
            value={reportType}
            options={[
              { key: 'statutory', label: t('fin.reportTypes.statutory') },
              { key: 'management', label: t('fin.reportTypes.management') },
            ]}
            onChange={setReportType}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-600">
            {t('rating.reportModal.currency')}
          </span>
          <Segmented
            value={currency}
            options={[
              { key: 'original', label: t('fin.fx.original') },
              { key: 'UZS', label: 'UZS' },
              { key: 'USD', label: 'USD' },
            ]}
            onChange={setCurrency}
          />
        </div>
      </div>
    </Modal>
  )
}
