/** Upload a .docx wording template. The file is checked in the browser
 *  first: a syntax error refuses it, unknown placeholders are listed (amber)
 *  and keep it from being activated until fixed. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { CountryPicker } from '../entities/CountryPicker'
import type { ProductStructure } from './api'
import { useUploadWordingTemplate } from './api'
import { inspectTemplate } from './docx'
import type { TemplateInspection } from './docx'
import { WORDING_SYNTAX } from './catalogue'
import { wordingErrorKey } from './errors'
import { TEMPLATE_LANGUAGES, languageName } from './labels'

const PRODUCTS: readonly ProductStructure[] = ['whole_turnover', 'key_buyers', 'single_buyer']

export function UploadTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const upload = useUploadWordingTemplate()
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<TemplateInspection | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [country, setCountry] = useState('')
  const [language, setLanguage] = useState(locale)
  const [product, setProduct] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setFile(null)
    setInspection(null)
    setName('')
    setDescription('')
    setCountry('')
    setProduct('')
    setError(null)
  }

  const pick = async (picked: File | null) => {
    setError(null)
    setFile(picked)
    setInspection(picked ? inspectTemplate(await picked.arrayBuffer()) : null)
    if (picked && !name) setName(picked.name.replace(/\.docx$/i, ''))
  }

  const submit = () => {
    if (!file || !name.trim() || inspection?.error) return
    setError(null)
    upload
      .mutateAsync({
        file,
        fileName: file.name,
        name: name.trim(),
        description,
        countryCode: country || null,
        language,
        product: (product || null) as ProductStructure | null,
      })
      .then(() => {
        reset()
        onClose()
      })
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  return (
    <Modal
      open={open}
      wide
      title={t('wording.upload.title')}
      onClose={() => {
        reset()
        onClose()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={!file || !name.trim() || Boolean(inspection?.error) || upload.isPending}
          >
            {upload.isPending ? t('common.saving') : t('wording.upload.submit')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('wording.upload.file')} hint={t('wording.upload.fileHint', WORDING_SYNTAX)}>
          <Input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
        </Field>
        {inspection?.error && (
          <div className="rounded-md border border-neg-500/30 bg-neg-50 px-3 py-2 text-[13px] text-neg-500" role="alert">
            {t('wording.errors.invalidTemplate')} <span className="font-mono">{inspection.error}</span>
          </div>
        )}
        {inspection && !inspection.error && (
          <div className="text-[13px] text-slate-600">
            {t('wording.upload.found', { count: inspection.placeholders.length })}
            {inspection.unknown.length > 0 && (
              <div className="mt-1 rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-warn-500">
                {t('wording.upload.unknown')} <span className="font-mono">{inspection.unknown.join(', ')}</span>
              </div>
            )}
          </div>
        )}
        <Field label={t('wording.fields.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('wording.fields.language')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {TEMPLATE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('wording.fields.country')} hint={t('wording.fields.countryHint')}>
            {/* Left empty, the template serves every country. */}
            <CountryPicker
              value={country || null}
              onChange={(code) => setCountry(code ?? '')}
              placeholder={t('wording.fields.anyCountry')}
            />
          </Field>
          <Field label={t('wording.fields.product')}>
            <Select value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">{t('wording.fields.anyProduct')}</option>
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>
                  {t(`policies.structures.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('wording.fields.description')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && (
          <div className="rounded-md border border-neg-500/30 bg-neg-50 px-3 py-2 text-[13px] text-neg-500" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
