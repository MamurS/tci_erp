/** «Проект договора» on a policy or a submission: generate a draft contract
 *  from the best-fitting active wording template and keep the history of
 *  what was generated. */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, EmptyState, Field, Modal, SectionTitle, Select, Table } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { formatMoment } from '../../lib/format'
import type { ProductStructure, WordingTarget } from './api'
import {
  bestTemplate,
  saveBlob,
  useGenerateDocument,
  usePolicyDocuments,
  useWordingTemplates,
  wordingDownloadUrl,
} from './api'
import { buildWordingContext } from './context'
import { WORDING_SYNTAX } from './catalogue'
import { wordingErrorKey } from './errors'
import { languageName, useWordingLabels } from './labels'

interface DraftContractSectionProps {
  target: WordingTarget
  /** Policy or submission number, for the file name. */
  reference: string
  countryCode: string | null
  product: ProductStructure | null
}

export function DraftContractSection({ target, reference, countryCode, product }: DraftContractSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const canGenerate = roles.some((r) => r === 'admin' || r === 'commercial_underwriter' || r === 'sales')
  const { data: documents } = usePolicyDocuments(target)
  const { data: templates } = useWordingTemplates()
  const active = useMemo(() => (templates ?? []).filter((x) => x.status === 'active'), [templates])
  const [open, setOpen] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const generate = useGenerateDocument()

  const chosen = active.find((x) => x.id === templateId) ?? null
  const { labels, ready } = useWordingLabels(chosen?.language ?? locale, target.policyId ? 'policy' : 'submission')

  useEffect(() => {
    if (open && !templateId) {
      setTemplateId(bestTemplate(active, { countryCode, product, language: locale })?.id ?? active[0]?.id ?? '')
    }
  }, [open, templateId, active, countryCode, product, locale])

  const run = () => {
    if (!chosen) return
    setError(null)
    const fileName = `${reference} — ${chosen.name}.docx`.replace(/[\\/:*?"<>|]+/g, '_')
    generate
      .mutateAsync({
        target,
        template: chosen,
        downloadName: fileName,
        buildContext: (data) => buildWordingContext(data, chosen.language, labels),
      })
      .then((blob) => {
        saveBlob(blob, fileName)
        setOpen(false)
      })
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  return (
    <Card className="p-5">
      <SectionTitle
        actions={
          canGenerate && (
            <Button size="sm" variant="accent" onClick={() => setOpen(true)}>
              {t('wording.generate.open')}
            </Button>
          )
        }
      >
        {t('wording.generate.title')}
      </SectionTitle>
      {!documents?.length ? (
        <EmptyState title={t('wording.generate.empty')} hint={t('wording.generate.emptyHint', WORDING_SYNTAX)} />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('wording.generate.generatedAt')}</th>
              <th>{t('wording.fields.name')}</th>
              <th>{t('wording.fields.language')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td className="text-xs">{formatMoment(d.generated_at, locale)}</td>
                <td>
                  {d.wording_templates?.name ?? '—'} <span className="text-xs text-slate-400">v{d.template_version}</span>
                </td>
                <td>{languageName(d.language, locale)}</td>
                <td className="text-right">
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
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {error && !open && <p className="mt-2 text-[13px] text-neg-500">{error}</p>}

      <Modal
        open={open}
        title={t('wording.generate.title')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={run} disabled={!chosen || !ready || generate.isPending}>
              {generate.isPending ? t('wording.generate.working') : t('wording.generate.submit')}
            </Button>
          </>
        }
      >
        {active.length === 0 ? (
          <p className="text-[13px] text-slate-600">{t('wording.generate.noTemplates')}</p>
        ) : (
          <div className="grid gap-3">
            <Field label={t('wording.generate.template')} hint={t('wording.generate.templateHint')}>
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {active.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {languageName(x.language, locale)}
                    {x.country_code ? ` · ${x.country_code}` : ''} · v{x.version}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-500">{t('wording.generate.draftNote')}</p>
          </div>
        )}
        {error && <p className="mt-2 text-[13px] text-neg-500">{error}</p>}
      </Modal>
    </Card>
  )
}
