/**
 * The brochure: its versions, the editor and a live preview.
 *
 * Every save is a NEW draft version (save_brochure_version); nothing is
 * edited in place. Publishing a draft makes it the brochure every new
 * commercial offer embeds, and retires the one before it. With no version
 * yet, the editor starts from the default draft (defaultContent.ts) under a
 * banner — it is never published by itself.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, FilePenLine, Send } from 'lucide-react'

import {
  Badge,
  Button,
  COL,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  RowActions,
  SectionTitle,
  Segmented,
  Skeleton,
  Table,
  ViewBar,
  actionsCol,
  labelCol,
} from '../../components/ui'
import { formatMoment } from '../../lib/format'
import {
  useBrochureVersions,
  useMediaAssets,
  usePublishBrochureVersion,
  useSaveBrochureVersion,
} from './api'
import { BrochureBody } from './BrochureBody'
import { BrochureEditor } from './BrochureEditor'
import { defaultBrochureContent } from './defaultContent'
import {
  STATUS_TONE,
  brochureLangOf,
  isDirty,
  missingTexts,
  normalizeContent,
  withLibraryImages,
} from './editor'
import { brochureErrorKey } from './errors'
import { BROCHURE_LANGS } from './model'
import type { BrochureContent, BrochureLang, BrochureVersion, MediaAsset } from './model'

const VERSION_COLUMNS = [
  COL.count,
  labelCol('brochureStatus'),
  COL.moment,
  COL.moment,
  COL.fill,
  actionsCol(['brochurePublish'], 2),
]

export function BrochureView() {
  const { t } = useTranslation()
  const versions = useBrochureVersions()
  const media = useMediaAssets()

  if (versions.isLoading)
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    )
  if (versions.error)
    return (
      <Callout tone="neg" title={t('common.loadFailed')}>
        {t(brochureErrorKey(versions.error))}
      </Callout>
    )
  return <Workspace versions={versions.data ?? []} assets={media.data ?? []} />
}

interface Base {
  version: BrochureVersion | null
  content: BrochureContent
}

function Workspace({ versions, assets }: { versions: BrochureVersion[]; assets: MediaAsset[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const save = useSaveBrochureVersion()
  const publish = usePublishBrochureVersion()

  // What the editor started from: the latest version, or the default draft.
  const [base, setBase] = useState<Base>(() => {
    const latest = versions[0]
    return latest
      ? { version: latest, content: normalizeContent(latest.content) }
      : { version: null, content: defaultBrochureContent() }
  })
  const [draft, setDraft] = useState<BrochureContent>(base.content)
  const [note, setNote] = useState('')
  const [lang, setLang] = useState<BrochureLang>(() => brochureLangOf(i18n.resolvedLanguage))
  const [previewLang, setPreviewLang] = useState<BrochureLang>(lang)
  const [viewing, setViewing] = useState<BrochureVersion | null>(null)
  const [viewLang, setViewLang] = useState<BrochureLang>(lang)
  const [publishing, setPublishing] = useState<BrochureVersion | null>(null)
  const [replacing, setReplacing] = useState<BrochureVersion | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = base.version === null || isDirty(draft, base.content)
  const current = versions.find((v) => v.status === 'published') ?? null
  const latest = versions[0] ?? null
  // «Опубликовать» in the editor publishes what was SAVED, never the screen.
  const publishable = !dirty && base.version?.status === 'draft' ? base.version : null

  const changeLang = (next: BrochureLang) => {
    setLang(next)
    setPreviewLang(next)
  }

  const load = (version: BrochureVersion) => {
    const content = normalizeContent(version.content)
    setBase({ version, content })
    setDraft(content)
    setNote('')
    setReplacing(null)
  }

  const startFrom = (version: BrochureVersion) => {
    if (dirty) setReplacing(version)
    else load(version)
  }

  const onSave = () => {
    setError(null)
    save.mutateAsync({ content: draft, note }).then(
      (row) => {
        setBase({ version: row, content: normalizeContent(row.content) })
        setDraft(normalizeContent(row.content))
        setNote('')
      },
      (e: unknown) => setError(t(brochureErrorKey(e))),
    )
  }

  const onPublish = () => {
    if (!publishing) return
    setError(null)
    publish.mutateAsync(publishing.id).then(
      (row) => {
        setPublishing(null)
        if (base.version?.id === row.id) setBase((b) => ({ ...b, version: row }))
      },
      (e: unknown) => {
        setPublishing(null)
        setError(t(brochureErrorKey(e)))
      },
    )
  }

  const missingOnPublish = publishing
    ? missingTexts(normalizeContent(publishing.content)).length
    : 0
  const preview = withLibraryImages(draft, assets)

  return (
    <div>
      <ViewBar
        hint={
          current
            ? t('brochure.currentIs', {
                version: current.version_no,
                date: current.published_at ? formatMoment(current.published_at, locale) : '—',
              })
            : t('brochure.noneCurrent')
        }
      />

      {error && <Callout tone="neg" title={error} className="mb-4" />}

      {versions.length === 0 && (
        <Callout tone="warn" title={t('brochure.defaultBanner.title')} className="mb-5">
          {t('brochure.defaultBanner.text')}
        </Callout>
      )}

      <SectionTitle className="mb-3">{t('brochure.versions.title')}</SectionTitle>
      {versions.length === 0 ? (
        <EmptyState title={t('brochure.versions.empty')} hint={t('brochure.versions.emptyHint')} />
      ) : (
        <Table columns={VERSION_COLUMNS}>
          <thead>
            <tr>
              <th className="num">{t('brochure.versions.number')}</th>
              <th>{t('brochure.versions.status')}</th>
              <th>{t('brochure.versions.created')}</th>
              <th>{t('brochure.versions.published')}</th>
              <th>{t('brochure.versions.note')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="num font-medium">{v.version_no}</td>
                <td>
                  <Badge tone={STATUS_TONE[v.status]}>{t(`brochure.statuses.${v.status}`)}</Badge>
                </td>
                <td>{formatMoment(v.created_at, locale)}</td>
                <td>
                  {v.published_at ? (
                    formatMoment(v.published_at, locale)
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td>{v.note ?? <span className="text-slate-400">—</span>}</td>
                <RowActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('brochure.actions.view')}
                    aria-label={t('brochure.actions.viewVersion', { version: v.version_no })}
                    onClick={() => {
                      setViewLang(lang)
                      setViewing(v)
                    }}
                  >
                    <Eye aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('brochure.actions.editAsNew')}
                    aria-label={t('brochure.actions.editAsNewVersion', { version: v.version_no })}
                    onClick={() => startFrom(v)}
                  >
                    <FilePenLine aria-hidden />
                  </Button>
                  {/* Only a draft is published; elsewhere the place stays empty. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={v.status !== 'draft'}
                    className={v.status === 'draft' ? '' : 'invisible'}
                    title={t('brochure.actions.publishHint')}
                    onClick={() => setPublishing(v)}
                  >
                    {t('brochure.actions.publish')}
                  </Button>
                </RowActions>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="mt-8 grid items-start gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle className="mb-1">{t('brochure.editor.heading')}</SectionTitle>
          {/* What the edit is based on, and whether it is saved: one line, always there. */}
          <p className="mb-4 min-h-5 text-[13px] text-slate-500">
            {base.version
              ? t('brochure.editor.basedOn', {
                  version: base.version.version_no,
                  status: t(`brochure.statuses.${base.version.status}`),
                })
              : t('brochure.editor.basedOnDefault')}
            {' · '}
            <span className={dirty ? 'font-medium text-slate-800' : 'text-pos-500'}>
              {dirty ? t('brochure.editor.unsaved') : t('brochure.editor.saved')}
            </span>
          </p>

          <BrochureEditor
            content={draft}
            onChange={setDraft}
            lang={lang}
            onLangChange={changeLang}
            assets={assets}
          />

          <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
            <label className="flex min-w-48 flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
                {t('brochure.editor.note')}
              </span>
              <Input
                value={note}
                maxLength={300}
                placeholder={t('brochure.editor.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button onClick={onSave} loading={save.isPending} disabled={!dirty}>
              {t('brochure.actions.save')}
            </Button>
            <Button
              variant="accent"
              disabled={!publishable}
              title={
                publishable
                  ? t('brochure.actions.publishHint')
                  : t('brochure.actions.publishSaveFirst')
              }
              onClick={() => publishable && setPublishing(publishable)}
            >
              <Send aria-hidden />
              {t('brochure.actions.publish')}
            </Button>
          </div>
          <p className="mt-2 min-h-5 text-xs text-slate-500">
            {latest && latest.status === 'draft' && latest.id !== base.version?.id
              ? t('brochure.editor.newerDraft', { version: latest.version_no })
              : t('brochure.editor.saveHint')}
          </p>
        </Card>

        <Card className="p-5 xl:sticky xl:top-4">
          <SectionTitle
            className="mb-4"
            actions={
              <Segmented
                value={previewLang}
                ariaLabel={t('brochure.preview.language')}
                options={BROCHURE_LANGS.map((l) => ({ key: l, label: t(`brochure.langs.${l}`) }))}
                onChange={(l) => setPreviewLang(l as BrochureLang)}
              />
            }
          >
            {t('brochure.preview.title')}
          </SectionTitle>
          <div className="scrollbar-thin max-h-[calc(100vh-10rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-6">
            <BrochureBody content={preview} lang={previewLang} />
          </div>
        </Card>
      </div>

      <Modal
        open={viewing !== null}
        wide
        title={viewing ? t('brochure.preview.versionTitle', { version: viewing.version_no }) : ''}
        onClose={() => setViewing(null)}
        footer={
          <Button variant="secondary" onClick={() => setViewing(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {viewing && (
          <>
            <Segmented
              value={viewLang}
              ariaLabel={t('brochure.preview.language')}
              options={BROCHURE_LANGS.map((l) => ({ key: l, label: t(`brochure.langs.${l}`) }))}
              onChange={(l) => setViewLang(l as BrochureLang)}
            />
            <div className="scrollbar-thin max-h-[65vh] overflow-y-auto rounded-md border border-slate-200 p-5">
              <BrochureBody content={viewing.content} lang={viewLang} />
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={publishing !== null}
        tone="primary"
        title={publishing ? t('brochure.publish.title', { version: publishing.version_no }) : ''}
        message={
          missingOnPublish > 0
            ? `${t('brochure.publish.message')} ${t('brochure.publish.missing', { n: missingOnPublish })}`
            : t('brochure.publish.message')
        }
        confirmLabel={t('brochure.actions.publish')}
        pending={publish.isPending}
        onConfirm={onPublish}
        onCancel={() => setPublishing(null)}
      />

      <ConfirmDialog
        open={replacing !== null}
        tone="primary"
        title={t('brochure.replace.title')}
        message={replacing ? t('brochure.replace.message', { version: replacing.version_no }) : ''}
        confirmLabel={t('brochure.replace.confirm')}
        onConfirm={() => replacing && load(replacing)}
        onCancel={() => setReplacing(null)}
      />
    </div>
  )
}
