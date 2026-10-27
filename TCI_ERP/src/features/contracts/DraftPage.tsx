/**
 * A contract draft (migration 0057): read it, edit it, compare its versions.
 *
 *   /policies/contracts/:id            the viewer (?v=N for an older version)
 *   /policies/contracts/:id/edit       the editor (TipTap, loaded only here)
 *   /policies/contracts/:id/compare    two versions (?a=&b=, default current vs previous)
 *
 * One layout for the three: the object header (number, status, what it is
 * for, the actions), the callouts that need attention, and below them the
 * contents of the clauses on the left with the comments and the status
 * history, the page-like sheet on the right.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  ActionsMenu,
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  Field,
  LinkButton,
  Select,
  Skeleton,
  Spinner,
} from '../../components/ui'
import type { MenuAction } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { formatMoment } from '../../lib/format'
import { useStaffDirectory } from '../data/api'
import { GenerateContractModal } from '../wording/GenerateContractModal'
import { useTemplateText } from '../wording/standardTemplates'
import { languageName } from '../wording/labels'
import {
  scanDownloadUrl,
  useContractDraft,
  useDraftComments,
  useRestoreVersion,
  useSaveVersion,
  useShareDraft,
  useStatusHistory,
  useVersion,
  useVersions,
} from './api'
import type { ContractDraftWithRefs } from './api'
import { CompareView } from './CompareView'
import type { CompareLayout } from './CompareView'
import { DocSheet } from './DocRenderer'
import { blockAnchor } from './sheet'
import { downloadVersionDocx, openVersionPdf } from './download'
import type { EditorHandle } from './editor/ContractEditor'
import { contractErrorKey } from './errors'
import { useCurrentContext, useStaleness } from './hooks'
import { canWrite, isEditable, SHAREABLE_STATUSES, statusActions, statusTone } from './machine'
import type { OfferedAction } from './machine'
import { refreshFields } from './mergeFields'
import type { ContractDoc } from './model'
import { SaveModal, SignModal, StatusModal } from './modals'
import { CommentsPanel, HistoryPanel, Toc } from './parts'
import { comparePath, draftPath, editPath, parseWarnings, versionPath } from './paths'
import { clearWorkingCopy, readWorkingCopy, workingCopyKey, writeWorkingCopy } from './workingCopy'
import type { WorkingCopy } from './workingCopy'

const ContractEditor = lazy(() => import('./editor/ContractEditor'))

type Mode = 'view' | 'edit' | 'compare'

export function ContractViewPage() {
  return <DraftPage mode="view" />
}
export function ContractEditPage() {
  return <DraftPage mode="edit" />
}
export function ContractComparePage() {
  return <DraftPage mode="compare" />
}

function targetLink(draft: ContractDraftWithRefs): { to: string; label: string } {
  return draft.policy_id
    ? { to: `/policies/${draft.policy_id}?tab=contract`, label: draft.policies?.policy_number ?? '' }
    : { to: `/requests/${draft.insurance_request_id ?? ''}`, label: draft.insurance_requests?.request_number ?? '' }
}

function DraftPage({ mode }: { mode: Mode }) {
  const { draftId } = useParams<{ draftId: string }>()
  const { t } = useTranslation()
  const { data: draft, isLoading, isError } = useContractDraft(draftId)
  const { data: versions } = useVersions(draftId)

  if (isLoading || (draft && !versions)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-[60vh]" />
      </div>
    )
  }
  if (isError || !draft || !versions) {
    return <EmptyState title={t('contractDrafts.notFound')} hint={t('contractDrafts.notFoundHint')} />
  }
  return <DraftScreen mode={mode} draft={draft} versions={versions} />
}

function DraftScreen({
  mode,
  draft,
  versions,
}: {
  mode: Mode
  draft: ContractDraftWithRefs
  versions: NonNullable<ReturnType<typeof useVersions>['data']>
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { roles, session } = useAuth()
  const writer = canWrite(roles)
  const editable = isEditable(draft.status)
  const { data: history } = useStatusHistory(draft.id)
  const { data: comments } = useDraftComments(draft.id)
  const { data: staff } = useStaffDirectory()
  const { context } = useCurrentContext(draft)
  const text = useTemplateText()

  const requested = Number(params.get('v'))
  const viewNo =
    mode === 'view' && Number.isInteger(requested) && versions.some((v) => v.version_no === requested)
      ? requested
      : draft.current_version_no
  const viewing = useVersion(draft.id, viewNo)
  const doc = viewing.data?.content ?? null
  const staleness = useStaleness(mode === 'view' ? doc : null, context)
  const warnings = parseWarnings(params.get('warnings'))

  const [statusAction, setStatusAction] = useState<OfferedAction | null>(null)
  const [signing, setSigning] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [confirm, setConfirm] = useState<'restore' | 'share' | 'unshare' | 'refresh' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const restore = useRestoreVersion()
  const share = useShareDraft()
  const save = useSaveVersion()

  const target = targetLink(draft)
  const reference = target.label
  const holder = draft.policies?.legal_entities?.name ?? draft.insurance_requests?.legal_entities?.name ?? null
  const actions = statusActions(draft.status, roles)
  const isCurrent = viewNo === draft.current_version_no
  const shared = draft.shared_version_id ? versions.find((v) => v.id === draft.shared_version_id) : null

  const runDownload = (format: 'docx' | 'pdf', versionNo = viewNo) => {
    setError(null)
    if (format === 'pdf') return openVersionPdf(draft.id, versionNo)
    void downloadVersionDocx({ draftId: draft.id, draftNumber: draft.draft_number, reference, versionNo, language: draft.language }).catch(
      (e: unknown) => setError(t(contractErrorKey(e))),
    )
  }

  const doConfirm = () => {
    setError(null)
    const done = () => setConfirm(null)
    const fail = (e: unknown) => {
      setConfirm(null)
      setError(t(contractErrorKey(e)))
    }
    if (confirm === 'restore') {
      restore
        .mutateAsync({ draftId: draft.id, baseVersionNo: draft.current_version_no, versionNo: viewNo, note: t('contractDrafts.restore.note', { version: viewNo }) })
        .then(() => {
          done()
          void navigate(draftPath(draft.id))
        })
        .catch(fail)
    } else if (confirm === 'share' || confirm === 'unshare') {
      share.mutateAsync({ draftId: draft.id, share: confirm === 'share' }).then(done).catch(fail)
    } else if (confirm === 'refresh' && doc && context) {
      const { doc: next } = refreshFields(doc, context)
      save
        .mutateAsync({
          draftId: draft.id,
          baseVersionNo: draft.current_version_no,
          content: next,
          source: 'refreshed',
          note: t('contractDrafts.regenerate.refreshNote', { count: staleness.fields.length }),
        })
        .then(done)
        .catch(fail)
    }
  }

  const menu: MenuAction[] = [
    ...(mode !== 'compare' && versions.length > 1
      ? [{ key: 'compare', label: t('contractDrafts.actions.compare'), onSelect: () => void navigate(comparePath(draft.id)) }]
      : []),
    ...(writer && editable ? [{ key: 'regenerate', label: t('contractDrafts.actions.regenerate'), onSelect: () => setRegenerating(true) }] : []),
    ...(writer && (SHAREABLE_STATUSES as readonly string[]).includes(draft.status)
      ? [
          {
            key: 'share',
            label:
              shared && shared.version_no === draft.current_version_no
                ? t('contractDrafts.actions.unshare')
                : t('contractDrafts.actions.share', { version: draft.current_version_no }),
            onSelect: () => setConfirm(shared && shared.version_no === draft.current_version_no ? 'unshare' : 'share'),
          },
        ]
      : []),
    ...actions
      .filter((a) => !a.primary)
      .map((a) => ({
        key: a.action,
        label: t(`contractDrafts.status.${a.action}.action`),
        onSelect: () => setStatusAction(a),
        danger: a.action === 'reopen',
      })),
  ]
  const primary = actions.find((a) => a.primary)

  const headerActions =
    mode === 'edit' ? null : (
      <>
        {mode === 'compare' && (
          <LinkButton variant="secondary" to={draftPath(draft.id)}>
            {t('contractDrafts.actions.backToDocument')}
          </LinkButton>
        )}
        {primary && mode === 'view' && (
          <Button onClick={() => (primary.action === 'sign' ? setSigning(true) : setStatusAction(primary))}>
            {t(`contractDrafts.status.${primary.action}.action`)}
          </Button>
        )}
        {writer && editable && mode === 'view' && (
          <LinkButton variant="secondary" to={editPath(draft.id)}>
            {t('contractDrafts.actions.edit')}
          </LinkButton>
        )}
        <ActionsMenu
          label={t('contractDrafts.actions.download')}
          actions={[
            { key: 'docx', label: t('contractDrafts.actions.docx'), onSelect: () => runDownload('docx') },
            { key: 'pdf', label: t('contractDrafts.actions.pdfPrint'), onSelect: () => runDownload('pdf') },
          ]}
        />
        {menu.length > 0 && <ActionsMenu actions={menu} />}
      </>
    )

  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        eyebrow={t('contractDrafts.title')}
        title={draft.draft_number}
        status={<Badge tone={statusTone(draft.status)}>{t(`contractDrafts.statuses.${draft.status}`)}</Badge>}
        meta={[
          <Link key="target" to={target.to} className="text-accent-700 hover:underline">
            {draft.policy_id ? t('contracts.forPolicy', { number: reference }) : t('contracts.forSubmission', { number: reference })}
          </Link>,
          ...(holder ? [<span key="holder">{holder}</span>] : []),
          <span key="template">
            {text.name(draft.wording_templates)} v{draft.wording_templates?.version} · {languageName(draft.language, locale)}
          </span>,
        ]}
        actions={mode === 'edit' ? undefined : headerActions}
      />

      {error && <Callout tone="neg" title={error} />}

      {mode === 'edit' ? (
        writer && editable ? (
          <EditorScreen draft={draft} userId={session?.user.id ?? 'anonymous'} context={context} />
        ) : (
          <Callout
            tone="warn"
            title={t('contractDrafts.locked.title')}
            action={<LinkButton size="sm" variant="secondary" to={draftPath(draft.id)}>{t('contractDrafts.actions.backToDocument')}</LinkButton>}
          >
            {draft.status === 'signed' ? t('contractDrafts.locked.signed') : t('contractDrafts.locked.notEditable')}
          </Callout>
        )
      ) : mode === 'compare' ? (
        <CompareScreen draftId={draft.id} versions={versions} current={draft.current_version_no} />
      ) : (
        <>
          <ViewCallouts
            draft={draft}
            viewNo={viewNo}
            isCurrent={isCurrent}
            staleCount={staleness.fields.length}
            scheduleChanged={staleness.scheduleChanged}
            sharedVersion={shared?.version_no ?? null}
            warnings={warnings}
            canRefresh={writer && editable && isCurrent && Boolean(context)}
            canRestore={writer && editable && !isCurrent}
            onRefresh={() => setConfirm('refresh')}
            onRestore={() => setConfirm('restore')}
            onDismissWarnings={() => {
              const next = new URLSearchParams(params)
              next.delete('warnings')
              setParams(next, { replace: true })
            }}
          />

          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('contractDrafts.versionSelect')}>
              <Select
                value={viewNo}
                onChange={(e) => void navigate(versionPath(draft.id, Number(e.target.value)), { replace: true })}
                className="w-[26rem]! max-w-full"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.version_no}>
                    {`v${v.version_no}${v.version_no === draft.current_version_no ? ` (${t('contractDrafts.current')})` : ''} · ${formatMoment(v.created_at, locale)} · ${t(`contractDrafts.sources.${v.source}`)}`}
                  </option>
                ))}
              </Select>
            </Field>
            {viewNo > 1 && (
              <LinkButton variant="ghost" to={comparePath(draft.id, viewNo - 1, viewNo)}>
                {t('contractDrafts.actions.compareWithPrevious')}
              </LinkButton>
            )}
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,clamp(calc(17rem*var(--ui-text,1)),24%,28rem))_minmax(0,1fr)]">
            <aside className="order-2 flex flex-col gap-5 xl:order-1">
              {doc && (
                <Toc
                  doc={doc}
                  onJump={(i) => document.getElementById(blockAnchor(i))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                />
              )}
              <CommentsPanel draftId={draft.id} comments={comments ?? []} versions={versions} staff={staff} />
              <HistoryPanel history={history ?? []} versions={versions} staff={staff} />
            </aside>
            <div className="order-1 min-w-0 xl:order-2">
              {doc ? <DocSheet doc={doc} stale={staleness.keys} /> : <Spinner />}
            </div>
          </div>
        </>
      )}

      <StatusModal draftId={draft.id} action={statusAction} onClose={() => setStatusAction(null)} />
      <SignModal draftId={draft.id} versionNo={draft.current_version_no} open={signing} onClose={() => setSigning(false)} />
      <GenerateContractModal
        open={regenerating}
        onClose={() => setRegenerating(false)}
        target={draft.policy_id ? { policyId: draft.policy_id } : { requestId: draft.insurance_request_id ?? '' }}
        reference={reference}
        countryCode={draft.policies?.legal_entities?.country_code ?? draft.insurance_requests?.legal_entities?.country_code ?? null}
        product={null}
      />
      <ConfirmDialog
        open={confirm !== null}
        tone="primary"
        title={confirm ? t(`contractDrafts.confirm.${confirm}.title`, { version: viewNo, current: draft.current_version_no }) : ''}
        message={confirm ? t(`contractDrafts.confirm.${confirm}.message`, { version: viewNo, current: draft.current_version_no, count: staleness.fields.length }) : ''}
        confirmLabel={confirm ? t(`contractDrafts.confirm.${confirm}.confirm`) : ''}
        pending={restore.isPending || share.isPending || save.isPending}
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function ViewCallouts({
  draft,
  viewNo,
  isCurrent,
  staleCount,
  scheduleChanged,
  sharedVersion,
  warnings,
  canRefresh,
  canRestore,
  onRefresh,
  onRestore,
  onDismissWarnings,
}: {
  draft: ContractDraftWithRefs
  viewNo: number
  isCurrent: boolean
  staleCount: number
  scheduleChanged: boolean
  sharedVersion: number | null
  warnings: readonly string[]
  canRefresh: boolean
  canRestore: boolean
  onRefresh: () => void
  onRestore: () => void
  onDismissWarnings: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [scanError, setScanError] = useState<string | null>(null)
  return (
    <>
      {draft.status === 'signed' && draft.signed_scan_path && (
        <Callout
          tone="pos"
          title={t('contractDrafts.signed.title', {
            version: draft.current_version_no,
            date: draft.signed_at ? formatMoment(draft.signed_at, locale) : '',
          })}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void scanDownloadUrl(draft.signed_scan_path!, draft.signed_scan_name ?? 'signed.pdf')
                  .then((url) => window.open(url, '_blank', 'noopener'))
                  .catch((e: unknown) => setScanError(t(contractErrorKey(e))))
              }
            >
              {t('contractDrafts.signed.download')}
            </Button>
          }
        >
          {t('contractDrafts.signed.body')}
          {scanError && <span className="mt-1 block text-neg-500">{scanError}</span>}
        </Callout>
      )}
      {draft.status === 'agreed' && <Callout tone="info" title={t('contractDrafts.locked.agreedTitle')}>{t('contractDrafts.locked.agreed')}</Callout>}
      {!isCurrent && (
        <Callout
          tone="info"
          title={t('contractDrafts.older.title', { version: viewNo, current: draft.current_version_no })}
          action={
            <span className="flex gap-2">
              {canRestore && (
                <Button size="sm" variant="secondary" onClick={onRestore}>
                  {t('contractDrafts.actions.restore', { version: viewNo })}
                </Button>
              )}
              <LinkButton size="sm" variant="ghost" to={draftPath(draft.id)}>
                {t('contractDrafts.actions.backToCurrent')}
              </LinkButton>
            </span>
          }
        >
          {t('contractDrafts.older.body')}
        </Callout>
      )}
      {staleCount > 0 && (
        <Callout
          tone="warn"
          title={t('contractDrafts.stale.title', { count: staleCount })}
          action={
            canRefresh ? (
              <Button size="sm" variant="secondary" onClick={onRefresh}>
                {t('contractDrafts.actions.refreshFields')}
              </Button>
            ) : undefined
          }
        >
          {t('contractDrafts.stale.body')}
        </Callout>
      )}
      {scheduleChanged && <Callout tone="warn" title={t('contractDrafts.stale.scheduleTitle')}>{t('contractDrafts.stale.scheduleBody')}</Callout>}
      {sharedVersion !== null && ['under_review', 'agreed', 'signed'].includes(draft.status) && (
        <Callout tone="info" title={t('contractDrafts.shared.title', { version: sharedVersion })}>
          {sharedVersion === draft.current_version_no
            ? t('contractDrafts.shared.current')
            : t('contractDrafts.shared.older', { current: draft.current_version_no })}
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout
          tone="warn"
          title={t('contractDrafts.warnings.title')}
          action={
            <Button size="sm" variant="ghost" onClick={onDismissWarnings}>
              {t('common.close')}
            </Button>
          }
        >
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{t(`contractDrafts.warnings.${w}`)}</li>
            ))}
          </ul>
        </Callout>
      )}
    </>
  )
}

function CompareScreen({ draftId, versions, current }: { draftId: string; versions: NonNullable<ReturnType<typeof useVersions>['data']>; current: number }) {
  const [params, setParams] = useSearchParams()
  const has = (n: number) => versions.some((v) => v.version_no === n)
  const a = Number(params.get('a'))
  const b = Number(params.get('b'))
  const newer = has(b) ? b : current
  const older = has(a) ? a : Math.max(1, newer - 1)
  const layout: CompareLayout = params.get('layout') === 'side' ? 'side' : 'inline'
  return (
    <CompareView
      draftId={draftId}
      versions={versions}
      older={older}
      newer={newer}
      layout={layout}
      onChange={(next) => {
        const p = new URLSearchParams(params)
        p.set('a', String(next.older ?? older))
        p.set('b', String(next.newer ?? newer))
        p.set('layout', next.layout ?? layout)
        setParams(p, { replace: true })
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// The editor screen
// ---------------------------------------------------------------------------

function EditorScreen({
  draft,
  userId,
  context,
}: {
  draft: ContractDraftWithRefs
  userId: string
  context: Record<string, unknown> | null
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const base = useVersion(draft.id, draft.current_version_no)
  const save = useSaveVersion()
  const key = workingCopyKey(draft.id, userId)
  const editorRef = useRef<EditorHandle>(null)
  const [working, setWorking] = useState<ContractDoc | null>(null)
  const [savedLocally, setSavedLocally] = useState<string | null>(null)
  const [stored] = useState<WorkingCopy | null>(() => readWorkingCopy(key))
  const [offerRestore, setOfferRestore] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [leaveTo, setLeaveTo] = useState<string | null>(null)

  const baseDoc = base.data?.content ?? null
  const baseJson = useMemo(() => (baseDoc ? JSON.stringify(baseDoc) : ''), [baseDoc])
  const doc = working ?? baseDoc
  const dirty = Boolean(working && baseJson && JSON.stringify(working) !== baseJson)
  const staleness = useStaleness(doc, context)
  const restorable =
    offerRestore && stored && baseJson && JSON.stringify(stored.content) !== baseJson ? stored : null

  // the local working copy: on every change, never a version
  useEffect(() => {
    if (!working) return
    const handle = setTimeout(() => {
      if (dirty) {
        const savedAt = new Date().toISOString()
        if (writeWorkingCopy(key, { baseVersionNo: draft.current_version_no, content: working, savedAt })) setSavedLocally(savedAt)
      } else clearWorkingCopy(key)
    }, 500)
    return () => clearTimeout(handle)
  }, [working, dirty, key, draft.current_version_no])

  // closing the tab with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // a link inside the app asks too (the browser router has no blocker)
  useEffect(() => {
    if (!dirty) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.origin !== window.location.origin) return
      if (anchor.closest('[role="dialog"]')) return
      e.preventDefault()
      e.stopPropagation()
      setLeaveTo(anchor.pathname + anchor.search)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty])

  // ⌘S / Ctrl+S saves (with its change note)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) setSaving(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty])

  const onChange = useCallback((next: ContractDoc) => setWorking(next), [])

  const doSave = (note: string) => {
    if (!working) return
    setSaveError(null)
    save
      .mutateAsync({ draftId: draft.id, baseVersionNo: draft.current_version_no, content: working, source: 'manual', note })
      .then(() => {
        clearWorkingCopy(key)
        setSaving(false)
        setWorking(null)
        void navigate(draftPath(draft.id))
      })
      .catch((e: unknown) => setSaveError(t(contractErrorKey(e))))
  }

  if (!baseDoc) return <Spinner />

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card">
        <p className="min-w-0 text-small text-slate-600" aria-live="polite">
          {t('contractDrafts.editor.editing', { version: draft.current_version_no })}
          <span className="ml-2 inline-block min-w-[16rem] text-slate-500">
            {dirty
              ? savedLocally
                ? t('contractDrafts.editor.localSaved', { time: formatMoment(savedLocally, locale) })
                : t('contractDrafts.editor.unsaved')
              : t('contractDrafts.editor.noChanges')}
          </span>
        </p>
        <span className="flex gap-2">
          <Button variant="secondary" onClick={() => (dirty ? setLeaveTo(draftPath(draft.id)) : void navigate(draftPath(draft.id)))}>
            {t('contractDrafts.actions.closeEditor')}
          </Button>
          <Button onClick={() => setSaving(true)} disabled={!dirty} title={t('contractDrafts.editor.saveShortcut')}>
            {t('contractDrafts.actions.saveVersion')}
          </Button>
        </span>
      </div>

      {restorable && (
        <Callout
          tone="info"
          title={t('contractDrafts.editor.restoreTitle', { time: formatMoment(restorable.savedAt, locale) })}
          action={
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  editorRef.current?.setDocument(restorable.content)
                  setOfferRestore(false)
                }}
              >
                {t('contractDrafts.editor.restore')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearWorkingCopy(key)
                  setOfferRestore(false)
                }}
              >
                {t('contractDrafts.editor.discard')}
              </Button>
            </span>
          }
        >
          {restorable.baseVersionNo === draft.current_version_no
            ? t('contractDrafts.editor.restoreBody')
            : t('contractDrafts.editor.restoreBodyOlder', { base: restorable.baseVersionNo, current: draft.current_version_no })}
        </Callout>
      )}

      {staleness.fields.length > 0 && context && (
        <Callout
          tone="warn"
          title={t('contractDrafts.stale.title', { count: staleness.fields.length })}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const editor = editorRef.current
                if (editor) editor.setDocument(refreshFields(editor.getDocument(), context).doc)
              }}
            >
              {t('contractDrafts.actions.refreshFields')}
            </Button>
          }
        >
          {t('contractDrafts.stale.editorBody')}
        </Callout>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,clamp(calc(17rem*var(--ui-text,1)),24%,28rem))_minmax(0,1fr)]">
        <aside className="order-2 xl:order-1 xl:sticky xl:top-4">
          {doc && <Toc doc={doc} onJump={(i) => editorRef.current?.scrollToBlock(i)} />}
        </aside>
        <div className="order-1 min-w-0 xl:order-2">
          <Suspense fallback={<Skeleton className="h-[70vh]" />}>
            <ContractEditor ref={editorRef} initial={baseDoc} stale={staleness.keys} context={context} onChange={onChange} />
          </Suspense>
        </div>
      </div>

      <SaveModal
        open={saving}
        baseVersionNo={draft.current_version_no}
        pending={save.isPending}
        error={saveError}
        onSave={doSave}
        onClose={() => setSaving(false)}
      />
      <ConfirmDialog
        open={leaveTo !== null}
        tone="danger"
        title={t('contractDrafts.editor.leaveTitle')}
        message={t('contractDrafts.editor.leaveBody')}
        confirmLabel={t('contractDrafts.editor.leave')}
        onConfirm={() => {
          const to = leaveTo
          setLeaveTo(null)
          setWorking(null)
          if (to) void navigate(to)
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </>
  )
}
