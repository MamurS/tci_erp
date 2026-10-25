/**
 * A version on paper — the PDF is the browser's own «Save as PDF» from here
 * (no server, nothing leaves our infrastructure). The page size and margins
 * are the template's, fields print as plain text, page breaks break, and the
 * footer reads "page x of y" in the document's language (@page margin box).
 * With ?auto=1 the print dialog opens as soon as the document is on screen.
 */

import { useEffect } from 'react'
import { usePrintScale } from '../account/uiScaleApi'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer } from 'lucide-react'

import { Spinner } from '../../components/ui'
import { useFixedT } from '../../i18n/useFixedT'
import { pageCounterContent } from '../entities/report/printRules'
import { wordingLocale } from '../wording/context'
import { useContractDraft, useVersion } from './api'
import { DocBody } from './DocRenderer'
import { sheetStyle } from './sheet'
import type { DocLayout } from './model'
import { A4_PAGE } from './model'
import { draftPath } from './paths'

const PAGE = '\u0001'
const PAGES = '\u0002'

function PageRules({ layout, pageOf }: { layout: DocLayout | null | undefined; pageOf: string }) {
  const page = layout?.page ?? A4_PAGE
  const mm = (tw: number) => `${(tw / 56.6929).toFixed(1)}mm`
  const css = `@page {
  size: ${mm(page.w)} ${mm(page.h)};
  margin: ${mm(page.top)} ${mm(page.right)} ${mm(page.bottom)} ${mm(page.left)};
  @bottom-center { content: ${pageCounterContent(pageOf, PAGE, PAGES)}; font-family: Arimo, Arial, sans-serif; font-size: 8pt; color: #666666; }
}
@media print { html, body { background: #fff !important; } .cd-print-toolbar { display: none !important; } }`
  return <style>{css}</style>
}

export function ContractPrintPage() {
  // A4 is laid out at 100 %, whatever size the screen uses (0076).
  usePrintScale()
  const { draftId } = useParams<{ draftId: string }>()
  const [params] = useSearchParams()
  const { t } = useTranslation()
  const { data: draft } = useContractDraft(draftId)
  const versionNo = Number(params.get('v')) || draft?.current_version_no || null
  const { data: version } = useVersion(draftId, versionNo)
  const docT = useFixedT(wordingLocale(draft?.language ?? 'ru'))
  const ready = Boolean(version && docT.ready)
  const auto = params.get('auto') === '1'

  useEffect(() => {
    if (!ready || !auto) return
    const handle = setTimeout(() => window.print(), 400)
    return () => clearTimeout(handle)
  }, [ready, auto])

  useEffect(() => {
    if (draft && versionNo) document.title = `${draft.draft_number} v${versionNo}`
  }, [draft, versionNo])

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {version && (
        <PageRules
          layout={version.content.attrs?.layout}
          pageOf={docT.t('report.pageOf', { page: PAGE, pages: PAGES })}
        />
      )}
      <div className="cd-print-toolbar sticky top-0 z-10 flex items-center gap-3 bg-accent-600 px-4 py-2 text-white">
        {draftId && (
          <Link
            to={draftPath(draftId)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-white/85 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-4" />
            {t('contractDrafts.print.back')}
          </Link>
        )}
        <div className="flex-1 truncate text-center font-display text-[0.9375rem] tracking-wide uppercase">
          {draft ? `${draft.draft_number} · v${versionNo ?? ''}` : ''}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-[0.8125rem] font-semibold text-white shadow-sm hover:brightness-105"
        >
          <Printer className="size-4" />
          {t('contractDrafts.print.print')}
        </button>
      </div>
      <div className="px-4 py-6 print:p-0">
        {!ready || !version ? (
          <Spinner />
        ) : (
          <article className="cd-sheet print:shadow-none" style={sheetStyle(version.content.attrs?.layout)}>
            <DocBody doc={version.content} plain />
          </article>
        )}
      </div>
    </div>
  )
}
