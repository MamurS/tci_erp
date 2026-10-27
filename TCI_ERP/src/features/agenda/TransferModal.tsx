/**
 * «Передать коллеге» (migration 0092): hand one task or several to a
 * colleague of the same department, with an optional note that reaches them
 * as a comment on the task. Opened from a row's menu (that row ticked) or
 * from the board's toolbar (nothing ticked: choose). Only the rows a person
 * may hand on are listed; the colleagues offered are those who may take
 * every task ticked (tci.task_transfer_candidates) — the database decides.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, EmptyState, Field, Modal, Select, Textarea } from '../../components/ui'
import { refusalKey } from '../../lib/refusals'
import { useTransferCandidates, useTransferTasks } from './api'
import type { TaskSubjects } from './api'
import type { AgendaRow } from './board'
import { rowTitle } from './rowText'
import { transferable } from './transfer'

export function TransferModal({
  rows,
  preselected,
  subjects,
  onClose,
  onDone,
}: {
  rows: readonly AgendaRow[]
  preselected: readonly string[]
  subjects: TaskSubjects | undefined
  onClose: () => void
  onDone: (count: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const offered = useMemo(() => rows.filter((row) => row.tasks.some(transferable)), [rows])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselected.filter((k) => offered.some((r) => r.key === k))))
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const transfer = useTransferTasks()

  const taskIds = useMemo(
    () => offered.filter((r) => picked.has(r.key)).flatMap((r) => r.tasks.filter(transferable).map((task) => task.id)),
    [offered, picked],
  )
  const candidates = useTransferCandidates(taskIds)
  const people = candidates.data ?? []
  const chosen = people.some((p) => p.user_id === to) ? to : ''

  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const submit = () => {
    setError(null)
    if (!chosen || taskIds.length === 0) return
    transfer
      .mutateAsync({ taskIds, to: chosen, note: note.trim() || null })
      .then((count) => {
        onDone(count)
        onClose()
      })
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      wide
      title={t('agenda.transfer.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={transfer.isPending} disabled={!chosen || taskIds.length === 0} onClick={submit}>
            {t('agenda.transfer.submit', { count: taskIds.length })}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('agenda.transfer.intro')}</p>
      {offered.length === 0 ? (
        <EmptyState pictogram="allDone" title={t('agenda.transfer.nothing')} hint={t('agenda.transfer.nothingHint')} />
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-2 flex w-full items-center justify-between text-small font-medium text-slate-700">
            <span>{t('agenda.transfer.tasks', { count: picked.size })}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(offered.map((r) => r.key)))}>
                {t('agenda.transfer.all')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                {t('agenda.transfer.none')}
              </Button>
            </span>
          </legend>
          <ul className="scrollbar-thin flex max-h-72 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-md border border-slate-200">
            {offered.map((row) => (
              <li key={row.key} className="border-b border-slate-100 last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={picked.has(row.key)} onChange={() => toggle(row.key)} />
                  <span className="min-w-0 flex-1 truncate text-body text-slate-800">
                    {rowTitle(row, t, locale, subjects, null)}
                  </span>
                  {row.tasks.length > 1 && (
                    <span className="shrink-0 text-caption text-slate-500">{t('agenda.transfer.items', { count: row.tasks.length })}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <Field
        label={t('agenda.transfer.to')}
        hint={taskIds.length && !candidates.isLoading && people.length === 0 ? t('agenda.transfer.noColleague') : t('agenda.transfer.toHint')}
      >
        <Select value={chosen} onChange={(e) => setTo(e.target.value)} disabled={taskIds.length === 0 || people.length === 0}>
          <option value="">{t('agenda.transfer.choose')}</option>
          {people.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.full_name ? `${p.full_name} · ${p.email}` : p.email}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('agenda.transfer.note')} hint={t('agenda.transfer.noteHint')}>
        <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
