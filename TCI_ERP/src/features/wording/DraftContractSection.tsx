/** «Проект договора» on a policy or a submission: the contract draft edited
 *  in the app (migration 0057) — its versions, each with its status, when it
 *  was saved, by whom and from which template, and the actions on each:
 *  view, edit (the current version, while the draft is editable), compare
 *  with the previous version, download as .docx or PDF. Files generated
 *  before drafts were editable stay listed below, for download. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Eye, GitCompareArrows, Pencil } from 'lucide-react'

import {
  ActionsMenu,
  actionsCol,
  Badge,
  Button,
  Card,
  COL,
  EmptyState,
  LinkButton,
  RowActions,
  SectionTitle,
  Table,
  Truncate,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatMoment } from '../../lib/format'
import { useStaffDirectory } from '../data/api'
import { useDraftForTarget, useStatusHistory, useVersions } from '../contracts/api'
import { CONTRACT_STATUS_COL, VERSION_ACTIONS_COL } from '../contracts/columns'
import { downloadVersionDocx, openVersionPdf } from '../contracts/download'
import { contractErrorKey } from '../contracts/errors'
import { versionStatuses } from '../contracts/hooks'
import { canWrite, isEditable, statusTone } from '../contracts/machine'
import { comparePath, draftPath, editPath, versionPath } from '../contracts/paths'
import type { ProductStructure, WordingTarget } from './api'
import { usePolicyDocuments, wordingDownloadUrl } from './api'
import { wordingErrorKey } from './errors'
import { GenerateContractModal } from './GenerateContractModal'
import { languageName } from './labels'
import { useTemplateText } from './standardTemplates'

interface DraftContractSectionProps {
  target: WordingTarget
  /** Policy or submission number, for the file name. */
  reference: string
  countryCode: string | null
  product: ProductStructure | null
}

function IconLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent-500 [&_svg]:size-4"
    >
      {children}
    </Link>
  )
}

/** Keeps a button's place in the row when it is not offered there. */
const Slot = () => <span className="inline-block size-8" aria-hidden />

export function DraftContractSection({ target, reference, countryCode, product }: DraftContractSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const writer = canWrite(roles)
  const { data: draft, isLoading } = useDraftForTarget(target)
  const { data: versions } = useVersions(draft?.id)
  const { data: history } = useStatusHistory(draft?.id)
  const { data: staff } = useStaffDirectory()
  const { data: documents } = usePolicyDocuments(target)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = useTemplateText()

  const statuses = draft && versions ? versionStatuses(draft, versions, history ?? []) : new Map()
  const editable = Boolean(draft && isEditable(draft.status))
  const person = (id: string) => {
    const m = staff?.get(id)
    return m ? m.full_name?.trim() || m.email : EM_DASH
  }
  // the template in effect for a version: the latest generation at or before it
  const templateOf = (versionNo: number) =>
    (versions ?? [])
      .filter((v) => v.source === 'generated' && v.version_no <= versionNo)
      .sort((a, b) => b.version_no - a.version_no)[0]?.wording_templates ?? draft?.wording_templates ?? null

  const download = (versionNo: number) => (format: 'docx' | 'pdf') => {
    if (!draft) return
    setError(null)
    if (format === 'pdf') return openVersionPdf(draft.id, versionNo)
    void downloadVersionDocx({
      draftId: draft.id,
      draftNumber: draft.draft_number,
      reference,
      versionNo,
      language: draft.language,
    }).catch((e: unknown) => setError(t(contractErrorKey(e))))
  }

  return (
    <Card className="p-5">
      <SectionTitle
        className="mb-3"
        hint={
          draft ? (
            <span className="inline-flex items-center gap-2">
              <span className="font-mono text-[12.5px] text-slate-600">{draft.draft_number}</span>
              <Badge tone={statusTone(draft.status)}>{t(`contractDrafts.statuses.${draft.status}`)}</Badge>
            </span>
          ) : undefined
        }
        actions={
          draft ? (
            <span className="flex flex-wrap gap-2">
              {writer && editable && (
                <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                  {t('contractDrafts.actions.regenerate')}
                </Button>
              )}
              <LinkButton size="sm" to={draftPath(draft.id)}>
                {t('contractDrafts.actions.openDraft')}
              </LinkButton>
            </span>
          ) : (
            writer && (
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {t('wording.generate.open')}
              </Button>
            )
          )
        }
      >
        {t('wording.generate.title')}
      </SectionTitle>

      {isLoading ? null : !draft ? (
        <EmptyState title={t('wording.generate.empty')} hint={t('contractDrafts.emptyHint')} />
      ) : (
        <Table dense fillMin="10rem" columns={['4.5rem', CONTRACT_STATUS_COL, COL.moment, '9.5rem', COL.fill, VERSION_ACTIONS_COL]}>
          <thead>
            <tr>
              <th>{t('contractDrafts.columns.version')}</th>
              <th>{t('contractDrafts.columns.status')}</th>
              <th>{t('contractDrafts.columns.saved')}</th>
              <th>{t('contractDrafts.columns.author')}</th>
              <th>{t('contractDrafts.columns.template')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(versions ?? []).map((v) => {
              const current = v.version_no === draft.current_version_no
              const status = statuses.get(v.id) ?? null
              const template = text.name(templateOf(v.version_no))
              const source =
                v.source === 'restored'
                  ? t('contractDrafts.sources.restoredFrom', { version: v.restored_from_version })
                  : t(`contractDrafts.sources.${v.source}`)
              const line = `${source} · ${template}${v.change_note ? ` — «${v.change_note}»` : ''}`
              return (
                <tr key={v.id}>
                  <td className="tabular-nums">
                    <span className={current ? 'font-semibold text-slate-900' : 'text-slate-600'}>v{v.version_no}</span>
                    {current && (
                      <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent-500 align-middle" title={t('contractDrafts.current')} />
                    )}
                  </td>
                  <td>
                    {status ? (
                      <Badge tone={current ? statusTone(status) : 'neutral'}>{t(`contractDrafts.statuses.${status}`)}</Badge>
                    ) : (
                      <span className="text-slate-400">{EM_DASH}</span>
                    )}
                  </td>
                  <td className="tabular-nums">{formatMoment(v.created_at, locale)}</td>
                  <td>
                    <Truncate text={person(v.author_id)} className="max-w-none">
                      {person(v.author_id)}
                    </Truncate>
                  </td>
                  <td>
                    <Truncate text={line} className="max-w-none">
                      <span className="text-slate-500">{source}</span> · {template}
                      {v.change_note && <span className="text-slate-500"> — «{v.change_note}»</span>}
                    </Truncate>
                  </td>
                  <RowActions>
                    <span className="flex items-center gap-1">
                      <IconLink to={versionPath(draft.id, v.version_no)} label={t('contractDrafts.actions.view')}>
                        <Eye />
                      </IconLink>
                      {writer && editable && current ? (
                        <IconLink to={editPath(draft.id)} label={t('contractDrafts.actions.edit')}>
                          <Pencil />
                        </IconLink>
                      ) : (
                        <Slot />
                      )}
                      {v.version_no > 1 ? (
                        <IconLink to={comparePath(draft.id, v.version_no - 1, v.version_no)} label={t('contractDrafts.actions.compare')}>
                          <GitCompareArrows />
                        </IconLink>
                      ) : (
                        <Slot />
                      )}
                      <ActionsMenu
                        size="sm"
                        trigger="icon"
                        label={t('contractDrafts.actions.download')}
                        actions={[
                          { key: 'docx', label: t('contractDrafts.actions.docx'), onSelect: () => download(v.version_no)('docx') },
                          { key: 'pdf', label: t('contractDrafts.actions.pdf'), onSelect: () => download(v.version_no)('pdf') },
                        ]}
                      />
                    </span>
                  </RowActions>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {error && (
        <p className="mt-2 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}

      {Boolean(documents?.length) && (
        <div className="mt-6">
          <SectionTitle className="mb-2" hint={t('contractDrafts.legacy.hint')}>
            {t('contractDrafts.legacy.title')}
          </SectionTitle>
          <Table dense columns={[COL.moment, COL.fill, actionsCol(['download'])]}>
            <thead>
              <tr>
                <th>{t('wording.generate.generatedAt')}</th>
                <th>{t('wording.generate.template')}</th>
                <th>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(documents ?? []).map((d) => {
                const name = text.name(d.wording_templates)
                return (
                  <tr key={d.id}>
                    <td className="tabular-nums">{formatMoment(d.generated_at, locale)}</td>
                    <td>
                      <Truncate text={`${name} v${d.template_version} · ${languageName(d.language, locale)}`} className="max-w-none">
                        {name}{' '}
                        <span className="text-xs text-slate-400">
                          <span className="tabular-nums">v{d.template_version}</span> · {languageName(d.language, locale)}
                        </span>
                      </Truncate>
                    </td>
                    <RowActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void wordingDownloadUrl(d.storage_path, d.file_name)
                            .then((url) => window.open(url, '_blank', 'noopener'))
                            .catch((e: unknown) => setError(t(wordingErrorKey(e))))
                        }
                      >
                        {t('wording.templates.download')}
                      </Button>
                    </RowActions>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}

      <GenerateContractModal
        open={open}
        onClose={() => setOpen(false)}
        target={target}
        reference={reference}
        countryCode={countryCode}
        product={product}
      />
    </Card>
  )
}
