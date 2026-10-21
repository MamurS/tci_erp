/** The shipped standard templates (ru / en / uz, any country, any product)
 *  and the action that installs them — used by «Шаблоны договоров» and by
 *  the contracts page when nothing is active yet. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EM_DASH } from '../../lib/format'
import { useSetTemplateStatus, useUploadWordingTemplate, useWordingTemplates } from './api'
import EN_URL from './defaults/policy-wording-en.docx?url'
import RU_URL from './defaults/policy-wording-ru.docx?url'
import UZ_URL from './defaults/policy-wording-uz.docx?url'

export const STANDARD_TEMPLATES = [
  { language: 'ru', url: RU_URL },
  { language: 'en', url: EN_URL },
  { language: 'uz', url: UZ_URL },
] as const

/** The file name the standard templates are uploaded under — how a shipped
 *  template is told from the insurer's own. */
const STANDARD_FILE = /^policy-wording-(ru|en|uz)\.docx$/

export function isStandardTemplate(template: { file_name: string } | null | undefined): boolean {
  return Boolean(template && STANDARD_FILE.test(template.file_name))
}

/** A template's name and description as the screen shows them. A shipped
 *  template's were stored in whatever language the installer's interface was
 *  in («Shipped with TCI ERP…» in a Russian interface); they are shown in the
 *  reader's language instead. The insurer's own templates read as entered. */
export function useTemplateText() {
  const { t } = useTranslation()
  return {
    name: (template: { name: string; file_name: string } | null | undefined): string =>
      !template ? EM_DASH : isStandardTemplate(template) ? t('wording.standard.name') : template.name,
    description: (template: { description: string | null; file_name: string }): string | null =>
      isStandardTemplate(template) ? t('wording.standard.description') : template.description,
  }
}

/** Uploads each standard template and activates it only where no active
 *  template exists for its key (any country, any product, that language). */
export function useInstallStandardTemplates() {
  const { t } = useTranslation()
  const { data: templates } = useWordingTemplates()
  const upload = useUploadWordingTemplate()
  const setStatus = useSetTemplateStatus()
  const [installing, setInstalling] = useState(false)

  const install = async () => {
    setInstalling(true)
    try {
      for (const std of STANDARD_TEMPLATES) {
        const blob = await (await fetch(std.url)).blob()
        const { template } = await upload.mutateAsync({
          file: blob,
          fileName: `policy-wording-${std.language}.docx`,
          name: t('wording.standard.name', { lng: std.language }),
          description: t('wording.standard.description'),
          countryCode: null,
          language: std.language,
          product: null,
        })
        const taken = (templates ?? []).some(
          (x) =>
            x.status === 'active' && x.country_code === null && x.product_structure === null && x.language === std.language,
        )
        if (!taken) await setStatus.mutateAsync({ id: template.id, status: 'active' })
      }
    } finally {
      setInstalling(false)
    }
  }

  return { install, installing }
}
