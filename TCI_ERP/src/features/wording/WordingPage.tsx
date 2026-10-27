/** «Шаблоны договоров»: the insurer's wording templates (upload, activate,
 *  retire — one active per jurisdiction, language and product), its
 *  particulars, and the placeholder reference. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

import {
  actionsCol,
  ActionsMenu,
  Badge,
  Button,
  Card,
  COL,
  ConfirmDialog,
  CountryFlag,
  EmptyState,
  labelCol,
  RowActions,
  SectionTitle,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { formatDate, formatMoment } from '../../lib/format'
import { useCountryName } from '../portfolio/useCountryName'
import type { WordingTemplate } from './api'
import { useSetTemplateStatus, useWordingTemplates, wordingDownloadUrl } from './api'
import { WORDING_SYNTAX } from './catalogue'
import { wordingErrorKey } from './errors'
import { InsurerProfileCard } from './InsurerProfileCard'
import { languageName } from './labels'
import { PlaceholderReference } from './PlaceholderReference'
import { useInstallStandardTemplates, useTemplateText } from './standardTemplates'
import { UploadTemplateModal } from './UploadTemplateModal'

const STATUS_TONE = { active: 'pos', draft: 'warn', retired: 'neutral' } as const

export function WordingPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const canManage = roles.includes('admin') || roles.includes('commercial_underwriter')
  const { data: templates, isLoading } = useWordingTemplates()
  const setStatus = useSetTemplateStatus()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retiring, setRetiring] = useState<WordingTemplate | null>(null)
  const { install, installing } = useInstallStandardTemplates()
  const text = useTemplateText()
  const countryName = useCountryName()

  const act = (id: string, status: 'active' | 'retired') => {
    setError(null)
    return setStatus.mutateAsync({ id, status }).catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  const installStandard = () => {
    setError(null)
    install().catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  const download = (template: WordingTemplate) => {
    wordingDownloadUrl(template.storage_path, template.file_name)
      .then((url) => window.open(url, '_blank', 'noopener'))
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  return (
    <div>
      <ViewBar
        hint={t('wording.subtitle', WORDING_SYNTAX)}
        actions={
          canManage && (
            <>
              <Button variant="secondary" disabled={installing} onClick={installStandard}>
                {installing ? t('common.saving') : t('wording.standard.install')}
              </Button>
              <Button variant="accent" onClick={() => setUploadOpen(true)}>
                {t('wording.upload.open')}
              </Button>
            </>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-3 text-small text-neg-500" role="alert">
          {error}
        </div>
      )}

      <Card className="mb-5 p-5">
        <SectionTitle className="mb-3">{t('wording.templates.title')}</SectionTitle>
        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !templates?.length ? (
          <EmptyState title={t('wording.templates.empty')} hint={t('wording.templates.emptyHint', WORDING_SYNTAX)} />
        ) : (
          <Table dense columns={[COL.fill, '11rem', labelCol('policyStructure'), labelCol('wordingStatus'), COL.date, actionsCol([], 2)]}>
            <thead>
              <tr>
                <th>{t('wording.fields.name')}</th>
                <th>{t('wording.fields.country')}</th>
                <th>{t('wording.fields.product')}</th>
                <th>{t('wording.fields.status')}</th>
                <th>{t('wording.fields.uploaded')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => {
                const name = text.name(tpl)
                const description = text.description(tpl)
                return (
                  <tr key={tpl.id}>
                    {/* Name, version and language on one line, the description
                        under it; the whole text on hover. */}
                    <td>
                      <Truncate
                        text={`${name} v${tpl.version} · ${languageName(tpl.language, locale)}`}
                        className="max-w-none"
                      >
                        <span className="font-medium text-slate-800">{name}</span>{' '}
                        <span className="text-caption text-slate-500">
                          <span className="tabular-nums">v{tpl.version}</span> · {languageName(tpl.language, locale)}
                        </span>
                      </Truncate>
                      {description && (
                        <Truncate text={description} className="max-w-none text-caption text-slate-500">
                          {description}
                        </Truncate>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {tpl.country_code ? (
                        <span className="inline-flex items-center gap-2">
                          <CountryFlag code={tpl.country_code} />
                          {countryName(tpl.country_code)}
                        </span>
                      ) : (
                        <span className="text-slate-500">{t('wording.fields.anyCountry')}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {tpl.product_structure ? (
                        t(`policies.structures.${tpl.product_structure}`)
                      ) : (
                        <span className="text-slate-500">{t('wording.fields.anyProduct')}</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[tpl.status]}>{t(`wording.statuses.${tpl.status}`)}</Badge>
                    </td>
                    <td className="whitespace-nowrap" title={formatMoment(tpl.uploaded_at, locale)}>
                      {formatDate(tpl.uploaded_at, locale)}
                    </td>
                    <RowActions>
                      {/* Download, then the next step, the retirement last and in red. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => download(tpl)}
                          title={t('wording.templates.download')}
                          aria-label={`${t('wording.templates.download')}: ${name}`}
                        >
                          <Download aria-hidden />
                        </Button>
                        {/* The next step and the retirement (last, in red) fold
                            into ⋯: as buttons they pushed the register past a
                            laptop's width. */}
                        {canManage && (
                          <ActionsMenu
                            trigger="icon"
                            size="sm"
                            actions={[
                              ...(tpl.status === 'draft'
                                ? [{ key: 'activate', label: t('wording.templates.activate'), onSelect: () => void act(tpl.id, 'active') }]
                                : []),
                              ...(tpl.status !== 'retired'
                                ? [{ key: 'retire', label: t('wording.templates.retire'), danger: true, onSelect: () => setRetiring(tpl) }]
                                : []),
                            ]}
                          />
                        )}
                    </RowActions>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mb-5">
        <InsurerProfileCard canEdit={roles.includes('admin')} />
      </div>
      <PlaceholderReference />

      <UploadTemplateModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <ConfirmDialog
        open={retiring !== null}
        title={t('wording.templates.retireTitle')}
        message={t('wording.templates.retireConfirm', {
          name: retiring ? text.name(retiring) : '',
          version: retiring?.version ?? '',
        })}
        confirmLabel={t('wording.templates.retire')}
        pending={setStatus.isPending}
        onCancel={() => setRetiring(null)}
        onConfirm={() => {
          if (!retiring) return
          void act(retiring.id, 'retired').then(() => setRetiring(null))
        }}
      />
    </div>
  )
}
