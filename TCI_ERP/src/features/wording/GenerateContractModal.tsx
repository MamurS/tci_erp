/** The «Сформировать проект договора» dialog: pick an active wording
 *  template (the best fit is preselected), fill it from the database's merge
 *  data in the template's language, and turn it into the EDITOR document of
 *  a contract draft (migration 0057) — the first version of a new draft, or
 *  a new version of the existing one. When the current version carries
 *  manual edits, the dialog says so and asks: keep the edits and refresh only
 *  the fields, or start a fresh version from the template. Used on a policy
 *  and on a submission (the target is fixed), and on the contracts page,
 *  where the policy or submission is chosen in the dialog itself. */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Combobox, Field, Modal } from '../../components/ui'
import type { ComboOption } from '../../components/ui'
import { useCountryName } from '../portfolio/useCountryName'
import {
  fetchMergeData,
  fetchVersion,
  useCreateDraft,
  useDraftForTarget,
  useSaveVersion,
  useVersions,
} from '../contracts/api'
import { contractErrorKey } from '../contracts/errors'
import { generateFromTemplate } from '../contracts/generate'
import { hasManualEdits, isEditable } from '../contracts/machine'
import { refreshFields } from '../contracts/mergeFields'
import { draftPath } from '../contracts/paths'
import type { ProductStructure, WordingTarget, WordingTemplate } from './api'
import { bestTemplate, fetchTemplateBytes, useWordingTemplates } from './api'
import { buildWordingContext } from './context'
import { WordingError } from './docx'
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

type Mode = 'refresh' | 'fresh'

export function GenerateContractModal(props: GenerateContractModalProps) {
  const { open, onClose } = props
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { data: templates } = useWordingTemplates()
  const active = useMemo(() => (templates ?? []).filter((x) => x.status === 'active'), [templates])
  const [templateId, setTemplateId] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('refresh')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const createDraft = useCreateDraft()
  const saveVersion = useSaveVersion()
  const text = useTemplateText()
  const countryName = useCountryName()

  const choices = props.choices
  const subject: ContractSubject | null = choices
    ? (choices.find((c) => c.id === pickedId) ?? null)
    : { target: props.target, reference: props.reference, countryCode: props.countryCode, product: props.product }
  const subjectKey = subject?.reference ?? ''

  const { data: draft } = useDraftForTarget(open ? subject?.target : null)
  const { data: versions } = useVersions(draft?.id)
  const edited = Boolean(draft && versions && hasManualEdits(versions))
  const locked = Boolean(draft && !isEditable(draft.status))

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
      setNotice(null)
      setPickedId(null)
      setMode('refresh')
    }
  }, [open])

  // For every subject, the best-fitting template is preselected again.
  useEffect(() => {
    setTemplateId('')
  }, [subjectKey])

  useEffect(() => {
    if (open && !templateId && active.length) {
      setTemplateId(
        (draft && active.some((x) => x.id === draft.template_id) ? draft.template_id : null) ??
          bestTemplate(active, {
            countryCode: subject?.countryCode ?? null,
            product: subject?.product ?? null,
            language: locale,
          })?.id ??
          active[0]!.id,
      )
    }
  }, [open, templateId, active, subject?.countryCode, subject?.product, locale, draft])

  const subjectOptions = useMemo<ComboOption[]>(
    () => (choices ?? []).map((c) => ({ id: c.id, label: c.label, keywords: [c.meta], meta: c.meta })),
    [choices],
  )

  const run = async () => {
    if (!chosen || !subject) return
    setError(null)
    setNotice(null)
    setWorking(true)
    try {
      const data = await fetchMergeData(subject.target)
      const context = buildWordingContext(data, chosen.language, labels)

      if (draft && edited && mode === 'refresh') {
        // keep the edits: only the merge fields of the current version move
        const current = await fetchVersion(draft.id, draft.current_version_no)
        const { doc, changed } = refreshFields(current.content, context)
        if (changed === 0) {
          setNotice(t('contractDrafts.regenerate.nothingChanged'))
          return
        }
        await saveVersion.mutateAsync({
          draftId: draft.id,
          baseVersionNo: draft.current_version_no,
          content: doc,
          source: 'refreshed',
          note: t('contractDrafts.regenerate.refreshNote', { count: changed }),
        })
        onClose()
        void navigate(draftPath(draft.id))
        return
      }

      const bytes = await fetchTemplateBytes(chosen.storage_path)
      let conversion
      try {
        conversion = generateFromTemplate(bytes, context)
      } catch (e) {
        throw new WordingError('invalid_template', e instanceof Error ? e.message : String(e))
      }
      if (!draft) {
        const created = await createDraft.mutateAsync({
          target: subject.target,
          templateId: chosen.id,
          content: conversion.doc,
        })
        onClose()
        void navigate(draftPath(created.id, conversion.warnings))
      } else {
        await saveVersion.mutateAsync({
          draftId: draft.id,
          baseVersionNo: draft.current_version_no,
          content: conversion.doc,
          source: 'generated',
          templateId: chosen.id,
          confirmReplace: edited,
        })
        onClose()
        void navigate(draftPath(draft.id, conversion.warnings))
      }
    } catch (e) {
      setError(t(contractErrorKey(e)))
    } finally {
      setWorking(false)
    }
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
      : locked
        ? t('contractDrafts.regenerate.locked')
        : null

  const title = draft ? t('contractDrafts.regenerate.title') : t('wording.generate.title')

  return (
    <Modal
      open={open}
      wide={active.length > 1 || edited}
      title={subject && !choices ? `${title} · ${subject.reference}` : title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={!chosen || !subject || !ready || working || locked}
            title={blockedReason ?? undefined}
          >
            {working
              ? t('wording.generate.working')
              : draft
                ? edited && mode === 'refresh'
                  ? t('contractDrafts.regenerate.submitRefresh')
                  : t('contractDrafts.regenerate.submit')
                : t('wording.generate.submit')}
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

      {draft && locked && (
        <Callout tone="warn" title={t('contractDrafts.regenerate.locked')}>
          {t(`contractDrafts.statuses.${draft.status}`)}
        </Callout>
      )}

      {draft && edited && !locked && (
        <Callout tone="warn" title={t('contractDrafts.regenerate.manualEditsTitle', { version: draft.current_version_no })}>
          {t('contractDrafts.regenerate.manualEditsBody')}
        </Callout>
      )}

      {draft && edited && !locked && (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('contractDrafts.regenerate.choose')}</legend>
          {(['refresh', 'fresh'] as const).map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${
                mode === m ? 'border-accent-500 bg-accent-50/70 ring-1 ring-accent-500' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="regenerate-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 accent-accent-600"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-slate-800">{t(`contractDrafts.regenerate.${m}`)}</span>
                <span className="block text-[12px] text-slate-500">{t(`contractDrafts.regenerate.${m}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {!(edited && mode === 'refresh') &&
        (active.length === 0 ? (
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
              <p className="mt-0.5 text-[12px] text-slate-500">{describe(active[0]!)}</p>
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
        ))}
      {active.length > 0 && <p className="text-xs text-slate-500">{t('contractDrafts.generateNote')}</p>}
      {notice && (
        <Callout tone="info" title={notice} />
      )}
      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
