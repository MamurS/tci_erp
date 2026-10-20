/** The «Сформировать проект договора» dialog: pick an active wording
 *  template (the best fit is preselected), fill it from the database's merge
 *  data in the template's language, store, register and download. Used on a
 *  policy, on a submission and on the contracts page. */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Modal, Select } from '../../components/ui'
import type { ProductStructure, WordingTarget } from './api'
import { bestTemplate, saveBlob, useGenerateDocument, useWordingTemplates } from './api'
import { buildWordingContext } from './context'
import { wordingErrorKey } from './errors'
import { languageName, useWordingLabels } from './labels'

interface GenerateContractModalProps {
  open: boolean
  onClose: () => void
  target: WordingTarget
  /** Policy or submission number, for the file name. */
  reference: string
  countryCode: string | null
  product: ProductStructure | null
}

export function GenerateContractModal({
  open,
  onClose,
  target,
  reference,
  countryCode,
  product,
}: GenerateContractModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: templates } = useWordingTemplates()
  const active = useMemo(() => (templates ?? []).filter((x) => x.status === 'active'), [templates])
  const [templateId, setTemplateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const generate = useGenerateDocument()

  const chosen = active.find((x) => x.id === templateId) ?? null
  const { labels, ready } = useWordingLabels(chosen?.language ?? locale, target.policyId ? 'policy' : 'submission')

  // A fresh choice for every target the dialog is opened on; the effect
  // below then preselects the best-fitting template.
  useEffect(() => {
    if (open) {
      setError(null)
      setTemplateId('')
    }
  }, [open, reference])

  useEffect(() => {
    if (open && !templateId && active.length) {
      setTemplateId(bestTemplate(active, { countryCode, product, language: locale })?.id ?? active[0].id)
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
        onClose()
      })
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  return (
    <Modal
      open={open}
      title={`${t('wording.generate.title')} · ${reference}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
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
  )
}
