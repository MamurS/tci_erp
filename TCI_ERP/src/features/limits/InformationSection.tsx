/**
 * «Сбор информации» on the limit request page (migration 0067): the request
 * waits for the buyer's data, not for a decision. It shows what is missing,
 * where to fill it in, «Проверить снова», and — for credit underwriting on a
 * request it did not raise — the waiver with a reason.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, LinkButton, Modal, Textarea } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { useBuyerInformationGaps, useRecheckInformation, useWaiveInformation } from './informationApi'
import { missingStatements } from './information'

export function InformationSection({
  requestId,
  entityId,
  mayWaive,
  onNotice,
}: {
  requestId: string
  entityId: string
  mayWaive: boolean
  onNotice: (message: string) => void
}) {
  const { t } = useTranslation()
  const gaps = useBuyerInformationGaps(entityId)
  const recheck = useRecheckInformation()
  const waive = useWaiveInformation()
  const [waiveOpen, setWaiveOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const missing = gaps.data ?? []
  const toFinancials = missingStatements(missing)

  const runRecheck = async () => {
    setError(null)
    try {
      const left = await recheck.mutateAsync({ requestId, entityId })
      onNotice(left.length === 0 ? t('limits.information.released') : t('limits.information.stillMissing'))
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.somethingWentWrong')))
    }
  }

  const runWaive = async () => {
    setError(null)
    try {
      await waive.mutateAsync({ requestId, entityId, comment })
      setWaiveOpen(false)
      setComment('')
      onNotice(t('limits.information.waived'))
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.somethingWentWrong')))
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-warn-500/30 bg-warn-50 p-5 text-body text-slate-800" role="note">
      <div className="font-semibold">{t('limits.information.title')}</div>
      <p>{t('limits.information.hint')}</p>
      {missing.length > 0 && (
        <ul className="list-disc pl-5">
          {missing.map((gap) => (
            <li key={gap}>{t(`limits.information.gaps.${gap}`)}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="text-neg-500" role="alert">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <LinkButton to={toFinancials ? `/entities/${entityId}?tab=financials` : `/entities/${entityId}`} variant="secondary">
          {t('limits.information.openCompany')}
        </LinkButton>
        <Button variant="secondary" loading={recheck.isPending} onClick={() => void runRecheck()}>
          {t('limits.information.recheck')}
        </Button>
        {mayWaive && (
          <Button variant="secondary" onClick={() => setWaiveOpen(true)}>
            {t('limits.information.waive')}
          </Button>
        )}
      </div>

      {waiveOpen && (
        <Modal
          open
          onClose={() => setWaiveOpen(false)}
          title={t('limits.information.waiveTitle')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setWaiveOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={waive.isPending}
                disabled={!comment.trim()}
                title={comment.trim() ? undefined : t('limits.information.waiveCommentRequired')}
                onClick={() => void runWaive()}
              >
                {t('limits.information.waive')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-body text-slate-600">{t('limits.information.waiveHint')}</p>
          <Field label={t('limits.information.waiveComment')}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </Field>
        </Modal>
      )}
    </Card>
  )
}
