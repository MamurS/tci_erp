/**
 * «Договоры» in the portal: the draft contracts the insurer SHARED with the
 * policyholder (v_client_contract_drafts, 0057) — read-only, the shared
 * version only, with a comment box while the draft is under review. A client
 * never edits; their comments go to the reviewers (client_comment_contract_draft).
 * Loaded as its own chunk: the portal never downloads the staff screens or
 * the editor.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Callout,
  COL,
  EmptyState,
  PageHeader,
  Panel,
  Spinner,
  Table,
  Textarea,
} from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { useClientComment, usePortalComments, usePortalDrafts } from './api'
import type { PortalDraft } from './api'
import { CONTRACT_STATUS_COL } from './columns'
import { DocSheet } from './DocRenderer'
import { contractErrorKey } from './errors'
import { CLIENT_COMMENT_STATUS, statusTone } from './machine'

export function PortalContractsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: drafts, isLoading } = usePortalDrafts()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = drafts?.find((d) => d.id === openId) ?? drafts?.[0] ?? null

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('contractDrafts.portal.title')} subtitle={t('contractDrafts.portal.subtitle')} />
      {!drafts?.length ? (
        <EmptyState title={t('contractDrafts.portal.empty')} hint={t('contractDrafts.portal.emptyHint')} />
      ) : (
        <>
          <Table dense columns={[COL.code, COL.fill, CONTRACT_STATUS_COL, '5rem', COL.moment]}>
            <thead>
              <tr>
                <th>{t('contractDrafts.portal.number')}</th>
                <th>{t('contractDrafts.portal.for')}</th>
                <th>{t('contractDrafts.columns.status')}</th>
                <th>{t('contractDrafts.columns.version')}</th>
                <th>{t('contractDrafts.portal.sharedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr
                  key={d.id}
                  className={`cursor-pointer hover:bg-slate-50 ${open?.id === d.id ? 'bg-accent-50/60' : ''}`}
                  onClick={() => setOpenId(d.id)}
                  aria-selected={open?.id === d.id}
                >
                  <td className="font-mono text-accent-700">{d.draft_number}</td>
                  <td>
                    {d.policy_id ? t('contracts.forPolicy', { number: d.reference }) : t('contracts.forSubmission', { number: d.reference })}
                  </td>
                  <td>
                    <Badge tone={statusTone(d.status)}>{t(`contractDrafts.statuses.${d.status}`)}</Badge>
                  </td>
                  <td className="tabular-nums">v{d.version_no}</td>
                  <td className="tabular-nums">{d.shared_at ? formatMoment(d.shared_at, locale) : ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {open && <PortalDraftView draft={open} />}
        </>
      )}
    </div>
  )
}

function PortalDraftView({ draft }: { draft: PortalDraft }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: comments } = usePortalComments(draft.id)
  const comment = useClientComment()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const canComment = draft.status === CLIENT_COMMENT_STATUS

  const send = () => {
    setError(null)
    setSent(false)
    comment
      .mutateAsync({ draftId: draft.id, body })
      .then(() => {
        setBody('')
        setSent(true)
      })
      .catch((e: unknown) => setError(t(contractErrorKey(e))))
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {/* plain: a policyholder reads the contract, not our field names */}
        <DocSheet doc={draft.content} plain />
      </div>
      <div className="flex flex-col gap-5">
        {draft.status === 'signed' && <Callout tone="pos" title={t('contractDrafts.portal.signed')} />}
        <Panel title={t('contractDrafts.portal.comments')} hint={canComment ? t('contractDrafts.portal.commentsHint') : t('contractDrafts.portal.commentsClosed')}>
          <ol className="flex flex-col gap-2.5">
            {(comments ?? []).length === 0 && <li className="text-[13px] text-slate-500">{t('contractDrafts.portal.noComments')}</li>}
            {(comments ?? []).map((c) => (
              <li key={c.id} className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="text-[12px] text-slate-500 tabular-nums">
                  {formatMoment(c.created_at, locale)} · v{c.version_no}
                </div>
                <p className="mt-1 text-[13px] whitespace-pre-wrap text-slate-800">{c.body}</p>
              </li>
            ))}
          </ol>
          {canComment && (
            <div className="mt-3 flex flex-col gap-2">
              <Textarea
                rows={4}
                value={body}
                maxLength={2000}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('contractDrafts.portal.placeholder')}
                aria-label={t('contractDrafts.portal.placeholder')}
              />
              {error && (
                <p className="text-[13px] text-neg-500" role="alert">
                  {error}
                </p>
              )}
              {sent && <p className="text-[13px] text-pos-500">{t('contractDrafts.portal.sent')}</p>}
              <div className="flex justify-end">
                <Button size="sm" disabled={!body.trim() || comment.isPending} onClick={send}>
                  {t('contractDrafts.portal.send')}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
