/** «Шаблоны договоров»: the insurer's wording templates (upload, activate,
 *  retire — one active per jurisdiction, language and product), its
 *  particulars, and the placeholder reference. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, ViewBar, SectionTitle, Spinner, Table } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { formatMoment } from '../../lib/format'
import type { WordingTemplate } from './api'
import { useSetTemplateStatus, useWordingTemplates, wordingDownloadUrl } from './api'
import { WORDING_SYNTAX } from './catalogue'
import { wordingErrorKey } from './errors'
import { InsurerProfileCard } from './InsurerProfileCard'
import { languageName } from './labels'
import { PlaceholderReference } from './PlaceholderReference'
import { useInstallStandardTemplates } from './standardTemplates'
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
  const { install, installing } = useInstallStandardTemplates()

  const act = (id: string, status: 'active' | 'retired') => {
    setError(null)
    setStatus.mutateAsync({ id, status }).catch((e: unknown) => setError(t(wordingErrorKey(e))))
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
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500" role="alert">
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
          <Table dense>
            <thead>
              <tr>
                <th>{t('wording.fields.name')}</th>
                <th>{t('wording.fields.language')}</th>
                <th>{t('wording.fields.country')}</th>
                <th>{t('wording.fields.product')}</th>
                <th>{t('wording.fields.version')}</th>
                <th>{t('wording.fields.status')}</th>
                <th>{t('wording.fields.uploaded')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id}>
                  <td className="min-w-56">
                    <span className="font-medium">{tpl.name}</span>
                    {tpl.description && <span className="block text-xs text-slate-500">{tpl.description}</span>}
                  </td>
                  <td>{languageName(tpl.language, locale)}</td>
                  <td>{tpl.country_code ?? t('wording.fields.anyCountry')}</td>
                  <td>
                    {tpl.product_structure
                      ? t(`policies.structures.${tpl.product_structure}`)
                      : t('wording.fields.anyProduct')}
                  </td>
                  <td className="num">v{tpl.version}</td>
                  <td>
                    <Badge tone={STATUS_TONE[tpl.status]}>{t(`wording.statuses.${tpl.status}`)}</Badge>
                  </td>
                  <td className="text-xs">{formatMoment(tpl.uploaded_at, locale)}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => download(tpl)}>
                      {t('wording.templates.download')}
                    </Button>
                    {canManage && tpl.status === 'draft' && (
                      <Button size="sm" variant="secondary" onClick={() => act(tpl.id, 'active')}>
                        {t('wording.templates.activate')}
                      </Button>
                    )}
                    {canManage && tpl.status !== 'retired' && (
                      <Button size="sm" variant="ghost" onClick={() => act(tpl.id, 'retired')}>
                        {t('wording.templates.retire')}
                      </Button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mb-5">
        <InsurerProfileCard canEdit={roles.includes('admin')} />
      </div>
      <PlaceholderReference />

      <UploadTemplateModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  )
}
