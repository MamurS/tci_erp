/** The draft screens' side column: the table of contents of the clauses,
 * the reviewers' comments and the status history. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Panel, Textarea } from '../../components/ui'
import { EM_DASH, formatMoment } from '../../lib/format'
import type { StaffMember } from '../data/types'
import type { DraftComment, StatusChange, VersionMeta } from './api'
import { useAddComment } from './api'
import { contractErrorKey } from './errors'
import type { ContractDoc } from './model'
import { tocEntries } from './toc'

export function Toc({ doc, onJump }: { doc: ContractDoc; onJump: (index: number) => void }) {
  const { t } = useTranslation()
  const entries = tocEntries(doc)
  return (
    <Panel title={t('contractDrafts.toc.title')}>
      {!entries.length ? (
        <p className="text-[13px] text-slate-500">{t('contractDrafts.toc.empty')}</p>
      ) : (
        <nav aria-label={t('contractDrafts.toc.title')} className="-mx-2 max-h-[55vh] overflow-y-auto">
          <ul className="flex flex-col">
            {entries.map((e) => (
              <li key={e.index}>
                <button
                  type="button"
                  onClick={() => onJump(e.index)}
                  title={`${e.label ?? ''} ${e.text}`.trim()}
                  className={`flex w-full gap-1.5 truncate rounded px-2 py-1 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-accent-500 ${
                    e.level === 3 ? 'pl-5 text-[12.5px] text-slate-500' : e.level === 1 ? 'text-[13px] font-semibold text-slate-800' : 'text-[13px] font-medium text-slate-700'
                  }`}
                >
                  {e.label && <span className="shrink-0 tabular-nums">{e.label}</span>}
                  <span className="truncate">{e.text || EM_DASH}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Panel>
  )
}

function personName(id: string, staff: Map<string, StaffMember> | undefined): string {
  const m = staff?.get(id)
  return m ? m.full_name?.trim() || m.email : EM_DASH
}

export function CommentsPanel({
  draftId,
  comments,
  versions,
  staff,
}: {
  draftId: string
  comments: readonly DraftComment[]
  versions: readonly VersionMeta[]
  staff: Map<string, StaffMember> | undefined
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useAddComment()
  const versionNo = (id: string) => versions.find((v) => v.id === id)?.version_no

  const send = () => {
    setError(null)
    add
      .mutateAsync({ draftId, body })
      .then(() => setBody(''))
      .catch((e: unknown) => setError(t(contractErrorKey(e))))
  }

  return (
    <Panel title={t('contractDrafts.comments.title')} hint={t('contractDrafts.comments.hint')}>
      <ol className="flex flex-col gap-3">
        {comments.length === 0 && <li className="text-[13px] text-slate-500">{t('contractDrafts.comments.empty')}</li>}
        {comments.map((c) => (
          <li key={c.id} className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-slate-500">
              <span className="font-medium text-slate-700">
                {c.author_side === 'client' ? t('contractDrafts.comments.policyholder') : personName(c.author_id, staff)}
              </span>
              {c.author_side === 'client' && <Badge tone="accent">{t('contractDrafts.comments.fromPortal')}</Badge>}
              <span className="tabular-nums">{formatMoment(c.created_at, locale)}</span>
              {versionNo(c.version_id) && <span className="tabular-nums">· v{versionNo(c.version_id)}</span>}
            </div>
            <p className="mt-1 text-[13px] whitespace-pre-wrap text-slate-800">{c.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-col gap-2">
        <Textarea
          rows={3}
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('contractDrafts.comments.placeholder')}
          aria-label={t('contractDrafts.comments.placeholder')}
        />
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" disabled={!body.trim() || add.isPending} onClick={send}>
            {t('contractDrafts.comments.send')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

export function HistoryPanel({
  history,
  versions,
  staff,
}: {
  history: readonly StatusChange[]
  versions: readonly VersionMeta[]
  staff: Map<string, StaffMember> | undefined
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const versionNo = (id: string) => versions.find((v) => v.id === id)?.version_no
  return (
    <Panel title={t('contractDrafts.history.title')}>
      {history.length === 0 ? (
        <p className="text-[13px] text-slate-500">{t('contractDrafts.history.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {[...history].reverse().map((h) => (
            <li key={h.id} className="text-[13px]">
              <div className="font-medium text-slate-800">
                {t(`contractDrafts.statuses.${h.to_status}`)}
                <span className="font-normal text-slate-500 tabular-nums"> · v{versionNo(h.version_id) ?? EM_DASH}</span>
              </div>
              <div className="text-[12px] text-slate-500">
                {personName(h.changed_by, staff)} · <span className="tabular-nums">{formatMoment(h.changed_at, locale)}</span>
              </div>
              {h.comment && <p className="mt-0.5 text-[12.5px] whitespace-pre-wrap text-slate-600">«{h.comment}»</p>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
