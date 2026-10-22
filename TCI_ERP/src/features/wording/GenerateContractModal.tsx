/** The «Сформировать проект договора» dialog: pick an active wording
 *  template (the best fit is preselected), fill it from the database's merge
 *  data in the template's language, store, register and download. Used on a
 *  policy and on a submission (the target is fixed), and on the contracts
 *  page, where the policy or submission is chosen in the dialog itself. */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Combobox, Field, Modal } from '../../components/ui'
import type { ComboOption } from '../../components/ui'
import { useCountryName } from '../portfolio/useCountryName'
import type { ProductStructure, WordingTarget, WordingTemplate } from './api'
import { bestTemplate, saveBlob, useGenerateDocument, useWordingTemplates } from './api'
import { buildWordingContext } from './context'
import { wordingErrorKey } from './errors'
import { languageName, useWordingLabels } from './labels'
import { useTemplateText } from './standardTemplates'

/** What a contract is generated for. */
export interface ContractSubject {
  target: WordingTarget
  /** Policy or submission number, for the file name. */
  reference: string
  countryCode: string | null
  product: ProductStructure | null
}

/** A subject offered in the dialog's own picker (the contracts page). */
export interface SubjectChoice extends ContractSubject {
  id: string
  label: string
  meta?: string
}

type GenerateContractModalProps = {
  open: boolean
  onClose: () => void
} & (
  | (ContractSubject & { choices?: never })
  | { choices: readonly SubjectChoice[]; target?: never; reference?: never; countryCode?: never; product?: never }
)

export function GenerateContractModal(props: GenerateContractModalProps) {
  const { open, onClose } = props
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: templates } = useWordingTemplates()
  const active = useMemo(() => (templates ?? []).filter((x) => x.status === 'active'), [templates])
  const [templateId, setTemplateId] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generate = useGenerateDocument()
  const text = useTemplateText()
  const countryName = useCountryName()

  const choices = props.choices
  const subject: ContractSubject | null = choices
    ? (choices.find((c) => c.id === pickedId) ?? null)
    : { target: props.target, reference: props.reference, countryCode: props.countryCode, product: props.product }
  const subjectKey = subject?.reference ?? ''

  const chosen = active.find((x) => x.id === templateId) ?? null
  const { labels, ready } = useWordingLabels(
    chosen?.language ?? locale,
    subject?.target.policyId ? 'policy' : 'submission',
  )

  // A fresh choice every time the dialog opens; the subject picked in it is
  // forgotten too.
  useEffect(() => {
    if (open) {
      setError(null)
      setPickedId(null)
    }
  }, [open])

  // For every subject, the best-fitting template is preselected again.
  useEffect(() => {
    setTemplateId('')
  }, [subjectKey])

  useEffect(() => {
    if (open && !templateId && active.length) {
      setTemplateId(
        bestTemplate(active, {
          countryCode: subject?.countryCode ?? null,
          product: subject?.product ?? null,
          language: locale,
        })?.id ?? active[0].id,
      )
    }
  }, [open, templateId, active, subject?.countryCode, subject?.product, locale])

  const subjectOptions = useMemo<ComboOption[]>(
    () => (choices ?? []).map((c) => ({ id: c.id, label: c.label, keywords: [c.meta], meta: c.meta })),
    [choices],
  )

  const run = () => {
    if (!chosen || !subject) return
    setError(null)
    const fileName = `${subject.reference} — ${text.name(chosen)}.docx`.replace(/[\\/:*?"<>|]+/g, '_')
    generate
      .mutateAsync({
        target: subject.target,
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

  const describe = (x: WordingTemplate) =>
    [
      languageName(x.language, locale),
      x.country_code ? countryName(x.country_code) : t('wording.generate.anyCountry'),
      x.product_structure ? t(`policies.structures.${x.product_structure}`) : t('wording.generate.anyProduct'),
      `v${x.version}`,
    ].join(' · ')

  const blockedReason = !subject
    ? t('wording.generate.pickSubject')
    : !chosen
      ? t('wording.generate.noTemplates')
      : null

  return (
    <Modal
      open={open}
      wide={active.length > 1}
      title={subject && !choices ? `${t('wording.generate.title')} · ${subject.reference}` : t('wording.generate.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={run}
            disabled={!chosen || !subject || !ready || generate.isPending}
            title={blockedReason ?? undefined}
          >
            {generate.isPending ? t('wording.generate.working') : t('wording.generate.submit')}
          </Button>
        </>
      }
    >
      {choices && (
        <Field label={t('wording.generate.subject')}>
          <Combobox
            value={pickedId}
            onChange={setPickedId}
            options={subjectOptions}
            openOnFocus
            autoFocus
            placeholder={t('wording.generate.subjectPlaceholder')}
          />
        </Field>
      )}

      {active.length === 0 ? (
        <p className="text-[13px] text-slate-600">{t('wording.generate.noTemplates')}</p>
      ) : active.length === 1 ? (
        // One template: nothing to choose, so it is stated, not offered in a
        // dropdown that cut its name short.
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
            {t('wording.generate.template')}
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[13.5px] font-medium text-slate-800">{text.name(active[0])}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">{describe(active[0])}</p>
          </div>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
            {t('wording.generate.template')}
          </legend>
          <p className="mb-1 text-xs text-slate-500">{t('wording.generate.templateHint')}</p>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {active.map((x) => {
              const selected = x.id === templateId
              return (
                <label
                  key={x.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                    selected ? 'border-accent-500 bg-accent-50/70 ring-1 ring-accent-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="wording-template"
                    value={x.id}
                    checked={selected}
                    onChange={() => setTemplateId(x.id)}
                    className="mt-1 accent-accent-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-slate-800">{text.name(x)}</span>
                    <span className="block text-[12px] text-slate-500">{describe(x)}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}
      {active.length > 0 && <p className="text-xs text-slate-500">{t('wording.generate.draftNote')}</p>}
      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
