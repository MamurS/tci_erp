/**
 * The media library: every image the brochure may use, with its alt text in
 * three languages, where it came from and on what licence. Images are
 * uploaded here and retired here — never removed, because a published
 * brochure that printed one keeps showing it.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ExternalLink, Pencil, Upload } from 'lucide-react'

import {
  Button,
  COL,
  Callout,
  ConfirmDialog,
  EmptyState,
  RowActions,
  Segmented,
  Spinner,
  Table,
  Truncate,
  ViewBar,
  actionsCol,
} from '../../components/ui'
import { formatDate, formatMoment } from '../../lib/format'
import { useMediaAssets, useRetireMediaAsset } from './api'
import { brochureLangOf } from './editor'
import { brochureErrorKey } from './errors'
import { licenceChoiceOf } from './media'
import { MediaFormModal } from './MediaFormModal'
import { MediaThumb } from './MediaThumb'
import { BROCHURE_LANGS } from './model'
import type { MediaAsset } from './model'

const COLUMNS = ['7rem', COL.fill, '14rem', COL.person, COL.date, actionsCol([], 2)]

export function MediaLibraryView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const { data, isLoading, error: loadError } = useMediaAssets()
  const retire = useRetireMediaAsset()
  const [filter, setFilter] = useState<'active' | 'retired'>('active')
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const [retiring, setRetiring] = useState<MediaAsset | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = (data ?? []).filter((a) => (filter === 'active' ? !a.retired_at : a.retired_at))

  const licenceLabel = (value: string) => {
    const choice = licenceChoiceOf(value)
    return choice === 'other' ? value : t(`media.licences.${choice}`)
  }

  const confirmRetire = () => {
    if (!retiring) return
    setError(null)
    retire.mutateAsync(retiring.id).then(
      () => setRetiring(null),
      (e: unknown) => {
        setRetiring(null)
        setError(t(brochureErrorKey(e)))
      },
    )
  }

  return (
    <div>
      <ViewBar
        hint={t('media.hint')}
        actions={
          <>
            <Segmented
              value={filter}
              ariaLabel={t('media.filter.label')}
              options={[
                { key: 'active', label: t('media.filter.active') },
                { key: 'retired', label: t('media.filter.retired') },
              ]}
              onChange={(key) => setFilter(key as 'active' | 'retired')}
            />
            <Button onClick={() => setUploading(true)}>
              <Upload aria-hidden />
              {t('media.upload.open')}
            </Button>
          </>
        }
      />

      {error && <Callout tone="neg" title={error} className="mb-4" />}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : loadError ? (
        <Callout tone="neg" title={t('common.loadFailed')}>
          {t(brochureErrorKey(loadError))}
        </Callout>
      ) : rows.length === 0 ? (
        filter === 'active' ? (
          <EmptyState title={t('media.empty.title')} hint={t('media.empty.hint')} />
        ) : (
          <EmptyState title={t('media.empty.retiredTitle')} hint={t('media.empty.retiredHint')} />
        )
      ) : (
        <Table columns={COLUMNS}>
          <thead>
            <tr>
              <th>{t('media.fields.image')}</th>
              <th>{t('media.fields.alt')}</th>
              <th>{t('media.fields.sourceAndLicence')}</th>
              <th>{t('media.fields.author')}</th>
              <th>
                {filter === 'active' ? t('media.fields.uploaded') : t('media.fields.retired')}
              </th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((asset) => {
              const when =
                filter === 'active' ? asset.created_at : (asset.retired_at ?? asset.created_at)
              return (
                <tr key={asset.id}>
                  <td>
                    <MediaThumb path={asset.storage_path} alt={asset.alt[brochureLangOf(locale)]} />
                  </td>
                  {/* Three lines, one per language, in every row: rows keep one height. */}
                  <td className="whitespace-normal">
                    {BROCHURE_LANGS.map((lang) => (
                      <Truncate
                        key={lang}
                        text={asset.alt[lang]}
                        className="max-w-none text-[13px]"
                      >
                        <span className="mr-1.5 inline-block w-6 font-display text-[11px] font-bold text-accent-500 uppercase">
                          {lang}
                        </span>
                        <span lang={lang}>{asset.alt[lang]}</span>
                      </Truncate>
                    ))}
                  </td>
                  <td className="whitespace-normal">
                    <Truncate text={asset.source} className="max-w-none">
                      {asset.source_url ? (
                        <a
                          href={asset.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent-600 hover:underline"
                        >
                          {asset.source}
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      ) : (
                        asset.source
                      )}
                    </Truncate>
                    <Truncate
                      text={licenceLabel(asset.licence)}
                      className="max-w-none text-xs text-slate-500"
                    >
                      {licenceLabel(asset.licence)}
                    </Truncate>
                  </td>
                  <td>{asset.author ?? <span className="text-slate-400">—</span>}</td>
                  <td title={formatMoment(when, locale)}>{formatDate(when, locale)}</td>
                  <RowActions>
                    {/* A retired image is history: nothing to edit, nothing to retire. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(asset.retired_at)}
                      className={asset.retired_at ? 'invisible' : ''}
                      title={t('media.edit.open')}
                      aria-label={t('media.edit.open')}
                      onClick={() => setEditing(asset)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(asset.retired_at)}
                      className={asset.retired_at ? 'invisible' : 'text-neg-500 hover:text-neg-600'}
                      title={t('media.retire.open')}
                      aria-label={t('media.retire.open')}
                      onClick={() => setRetiring(asset)}
                    >
                      <Archive aria-hidden />
                    </Button>
                  </RowActions>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <MediaFormModal open={uploading} onClose={() => setUploading(false)} />
      <MediaFormModal open={editing !== null} asset={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={retiring !== null}
        title={t('media.retire.title')}
        message={t('media.retire.message')}
        confirmLabel={t('media.retire.confirm')}
        pending={retire.isPending}
        onConfirm={confirmRetire}
        onCancel={() => setRetiring(null)}
      />
    </div>
  )
}
