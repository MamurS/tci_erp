/** «Проект договора» on a policy or a submission: generate a draft contract
 *  from the best-fitting active wording template and keep the history of
 *  what was generated. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, EmptyState, SectionTitle, Table, Truncate } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { formatMoment } from '../../lib/format'
import type { ProductStructure, WordingTarget } from './api'
import { usePolicyDocuments, wordingDownloadUrl } from './api'
import { WORDING_SYNTAX } from './catalogue'
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

export function DraftContractSection({ target, reference, countryCode, product }: DraftContractSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const canGenerate = roles.some((r) => r === 'admin' || r === 'commercial_underwriter' || r === 'sales')
  const { data: documents } = usePolicyDocuments(target)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = useTemplateText()

  return (
    <Card className="p-5">
      <SectionTitle
        className="mb-3"
        actions={
          canGenerate && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
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
              {/* The template name takes what is left and cuts with an
                  ellipsis: this card is often a side column. */}
              <th className="cell-fill w-[60%]">{t('wording.generate.template')}</th>
              <th className="w-px" />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => {
              const name = text.name(d.wording_templates)
              return (
              <tr key={d.id}>
                <td className="whitespace-nowrap tabular-nums">{formatMoment(d.generated_at, locale)}</td>
                <td className="cell-fill">
                  {/* Name, version and language on one line. */}
                  <Truncate
                    text={`${name} v${d.template_version} · ${languageName(d.language, locale)}`}
                    className="max-w-none"
                  >
                    {name}{' '}
                    <span className="text-xs text-slate-400">
                      <span className="tabular-nums">v{d.template_version}</span> · {languageName(d.language, locale)}
                    </span>
                  </Truncate>
                </td>
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
