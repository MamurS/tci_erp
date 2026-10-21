/**
 * «Запросить свежую отчётность» on the company card: anyone on staff asks
 * the information managers for this company's latest statements (0054). An
 * open request for the same company is joined, not duplicated.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Modal, Textarea } from '../../components/ui'
import { refusalKey } from '../../lib/refusals'
import { useRequestStatementsUpdate, useStaffDirectory } from './api'
import { staffName } from './staff'
import type { RequestResult } from './types'

export function RequestStatementsButton({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const request = useRequestStatementsUpdate()
  const staff = useStaffDirectory()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<RequestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setNote('')
    setResult(null)
    setError(null)
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('data.statementsRequest.button')}
      </Button>
      <Modal
        open={open}
        title={t('data.statementsRequest.title')}
        onClose={close}
        footer={
          result ? (
            <Button onClick={close}>{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={request.isPending}
                onClick={() =>
                  request
                    .mutateAsync({ entityId, note })
                    .then(setResult)
                    .catch((e: unknown) => setError(t(refusalKey(e))))
                }
              >
                {t('data.statementsRequest.submit')}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <Callout
            tone={result.result === 'requested' ? 'pos' : 'info'}
            title={
              result.result === 'requested'
                ? t('data.requestModal.requested', { number: result.request_number })
                : t('data.requestModal.alreadyRequested', { number: result.request_number })
            }
            action={
              <Link to={`/data/requests/${result.request_id}`} onClick={close} className="font-medium text-accent-600 hover:underline">
                {t('data.statementsRequest.open')}
              </Link>
            }
          >
            {result.assigned_to
              ? t('data.requestModal.assignedTo', { name: staffName(staff.data, result.assigned_to) })
              : t('data.requestModal.toTeam')}
          </Callout>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-slate-600">{t('data.statementsRequest.hint')}</p>
            {error && <Callout tone="neg" title={error} />}
            <Field label={t('data.fields.note')} hint={t('data.statementsRequest.noteHint')}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}
