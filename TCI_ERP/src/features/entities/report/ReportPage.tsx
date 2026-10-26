/**
 * Risk Report as a document: /entities/:id/report?lang=&type=&ccy=
 *
 * The A4 face of the report (the online face is the company card's Overview
 * tab — both render RiskReportBody over useRiskReport). Print gives the same
 * page through report.css: the running header is the `thead` of a one-cell
 * layout table, so it repeats on every page, and the footer is drawn in the
 * @page margin boxes with "page x of y".
 *
 * The report language is independent of the UI language (useFixedT loads it
 * on demand).
 */

import { Link, useParams, useSearchParams } from 'react-router-dom'
import { usePrintScale } from '../../account/uiScaleApi'
import type { TFunction } from 'i18next'
import { ArrowLeft, Printer } from 'lucide-react'

import { Spinner } from '../../../components/ui'
import { useFixedT } from '../../../i18n/useFixedT'
import { BRAND } from '../../../lib/brand'
import { formatLongDate } from '../../../lib/format'
import type { DisplayCurrency } from '../financials/fx'
import { cssString, pageCounterContent } from './printRules'
import { ReportHeader, RiskReportBody } from './RiskReportDocument'
import { useRiskReport } from './useRiskReport'
import './report.css'

type Lang = 'en' | 'ru' | 'uz'

export function ReportPage() {
  // A4 is laid out at 100 %, whatever size the screen uses (0076).
  usePrintScale()
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const langParam = searchParams.get('lang')
  const lang: Lang = langParam === 'en' || langParam === 'uz' ? langParam : 'ru'
  const reportType = searchParams.get('type') === 'management' ? 'management' : 'statutory'
  const ccyParam = searchParams.get('ccy')
  const displayCurrency: DisplayCurrency =
    ccyParam === 'UZS' || ccyParam === 'USD' || ccyParam === 'EUR' ? ccyParam : 'original'

  const { t, ready: languageReady } = useFixedT(lang)
  const report = useRiskReport({ entityId: id, locale: lang, reportType, displayCurrency })
  const entity = report.entity

  if (report.loading || !languageReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!entity) return null

  return (
    <div className="rpt min-h-screen" lang={lang}>
      <PrintPageRules t={t} />

      <div className="rpt-toolbar">
        <Link
          to={`/entities/${id}`}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-small text-white/85 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          {t('report.backToBuyer')}
        </Link>
        <div className="flex-1 truncate text-center font-display text-lead tracking-wide uppercase">
          {entity.name}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-small font-semibold text-white shadow-sm hover:bg-sky-700"
        >
          <Printer className="size-4" />
          {t('report.print')}
        </button>
      </div>

      <div className="rpt-viewport">
        <article className="rpt-sheet">
          <table className="rpt-layout">
            <thead>
              <tr>
                <td>
                  <ReportHeader
                    t={t}
                    name={entity.name}
                    registration={entity.registration_number}
                    date={formatLongDate(report.today, lang)}
                  />
                </td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <RiskReportBody report={{ ...report, entity }} t={t} locale={lang} variant="print" />
                  <div className="rpt-footer">
                    <span>
                      © {BRAND.copyright} {report.today.getFullYear()}
                    </span>
                    <span className="mid">{t('report.tagline')}</span>
                    <span>{entity.name}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </div>
  )
}

const PAGE = '\u0001'
const PAGES = '\u0002'

/** The A4 page and its footer, in the report language. The margin boxes are
 * the only place "page x of y" can be drawn, and their content must be a
 * literal — hence a generated rule rather than a class. */
function PrintPageRules({ t }: { t: TFunction }) {
  const box =
    "font-family: 'PT Sans Narrow', 'Arial Narrow', sans-serif; font-size: 8pt; vertical-align: top; padding-top: 2.5mm; border-top: 0.6pt solid #c9dde9;"
  const css = `@page {
  size: A4;
  margin: 11mm 12mm 15mm;
  @bottom-left { content: ${cssString(`© ${BRAND.copyright} ${new Date().getFullYear()}`)}; color: #666666; ${box} }
  @bottom-center { content: ${cssString(`■  ${t('report.tagline')}`)}; color: #005288; font-weight: 700; ${box} }
  @bottom-right { content: ${pageCounterContent(t('report.pageOf', { page: PAGE, pages: PAGES }), PAGE, PAGES)}; color: #666666; ${box} }
}`
  return <style>{css}</style>
}
