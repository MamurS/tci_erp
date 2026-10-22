/**
 * The offer on paper — and the full-page viewer. The PDF is the browser's own
 * «Save as PDF» from here (no server, nothing leaves our infrastructure): A4,
 * the cover on its own page, the brochure from a new page, table rows and
 * sections never split, and a "page x of y" footer in the OFFER's language
 * (@page margin box). ?auto=1 opens the print dialog once the document is on
 * screen; ?v=N shows that version (staff only — the portal shows what was
 * published).
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer } from 'lucide-react'

import { EmptyState, Spinner } from '../../components/ui'
import { useFixedT } from '../../i18n/useFixedT'
import { pageCounterContent } from '../entities/report/printRules'
import { useBrochureContent, useClientOffers, useOffer, useOfferVersion } from './api'
import { offerDocumentTitle, offerToday } from './machine'
import type { OfferDocumentInput } from './model'
import { OfferDocument } from './OfferDocument'

const PAGE = '\u0001'
const PAGES = '\u0002'

function PageRules({ pageOf }: { pageOf: string }) {
  const css = `@page {
  size: A4;
  margin: 16mm 15mm 18mm 18mm;
  @bottom-center { content: ${pageCounterContent(pageOf, PAGE, PAGES)}; font-family: Arimo, Arial, sans-serif; font-size: 8pt; color: #666666; }
}
@page :first { @bottom-center { content: none; } }
@media print { html, body { background: #fff !important; } .kp-print-toolbar { display: none !important; } }`
  return <style>{css}</style>
}

function PrintFrame({
  input,
  backTo,
  backLabel,
  missing,
}: {
  input: OfferDocumentInput | null
  backTo: string
  backLabel: string
  missing: boolean
}) {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const docT = useFixedT(input?.language ?? 'ru')
  const ready = Boolean(input && docT.ready)
  const auto = params.get('auto') === '1'

  useEffect(() => {
    if (!ready || !auto) return
    // The brochure's images arrive through signed URLs after the text: print
    // once every image on the page has settled (loaded or failed) and the
    // fonts are in, so the PDF never captures an empty picture box.
    let cancelled = false
    const settled = () =>
      Array.from(document.images).every((img) => img.complete) && document.fonts.status === 'loaded'
    const started = Date.now()
    const tick = () => {
      if (cancelled) return
      if (settled() || Date.now() - started > 10_000) window.print()
      else handle = setTimeout(tick, 200)
    }
    let handle = setTimeout(tick, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [ready, auto])

  useEffect(() => {
    if (input) document.title = offerDocumentTitle(input.offerNumber, input.data.client.name)
  }, [input])

  let body: ReactNode
  if (missing) body = <EmptyState title={t('offers.print.missing')} hint={t('offers.print.missingHint')} />
  else if (!ready || !input) body = <Spinner />
  else body = <OfferDocument input={input} t={docT.t} print />

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {ready && <PageRules pageOf={docT.t('report.pageOf', { page: PAGE, pages: PAGES })} />}
      <div className="kp-print-toolbar sticky top-0 z-10 flex items-center gap-3 bg-accent-600 px-4 py-2 text-white">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-white/85 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
        <div className="flex-1 truncate text-center font-display text-[15px] tracking-wide uppercase">
          {input ? `${input.offerNumber} · v${input.versionNo}` : ''}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
        >
          <Printer className="size-4" />
          {t('offers.print.print')}
        </button>
      </div>
      <div className="px-4 py-6 print:p-0">
        <div className="mx-auto max-w-[210mm] bg-white shadow-sm print:max-w-none print:shadow-none">
          <div className="p-[14mm] print:p-0">{body}</div>
        </div>
      </div>
    </div>
  )
}

/** Staff: any version of an offer. */
export function OfferPrintPage() {
  const { offerId } = useParams<{ offerId: string }>()
  const [params] = useSearchParams()
  const { t } = useTranslation()
  const { data: offer, isLoading } = useOffer(offerId)
  const versionNo = Number(params.get('v')) || offer?.current_version_no || null
  const { data: version, isLoading: versionLoading } = useOfferVersion(offerId, versionNo)
  const { data: brochure } = useBrochureContent(version?.include_brochure ? version.brochure_version_id : null)
  const brochureReady = !version?.include_brochure || !version.brochure_version_id || brochure !== undefined

  const input: OfferDocumentInput | null =
    offer && version && brochureReady
      ? {
          offerNumber: offer.offer_number,
          language: offer.language,
          validUntil: version.valid_until,
          date: offerToday(new Date(version.created_at)),
          versionNo: version.version_no,
          texts: version.texts,
          data: version.data,
          brochure: version.include_brochure ? (brochure ?? null) : null,
        }
      : null

  return (
    <PrintFrame
      input={input}
      backTo={offer ? `/requests/${offer.insurance_request_id}?focus=offer` : '/requests'}
      backLabel={t('offers.print.back')}
      missing={!isLoading && !versionLoading && (!offer || (Boolean(versionNo) && !version))}
    />
  )
}

/** Portal: the published version of one of the client's offers. */
export function PortalOfferPrintPage() {
  const { offerId } = useParams<{ offerId: string }>()
  const { t } = useTranslation()
  const { data: offers, isLoading } = useClientOffers()
  const offer = offers?.find((o) => o.id === offerId) ?? null
  const input: OfferDocumentInput | null =
    offer && offer.texts && offer.data && offer.version_no
      ? {
          offerNumber: offer.offer_number,
          language: offer.language,
          validUntil: offer.valid_until,
          date: offerToday(new Date(offer.published_at ?? offer.data.composed_at)),
          versionNo: offer.version_no,
          texts: offer.texts,
          data: offer.data,
          brochure: offer.include_brochure ? offer.brochure_content : null,
        }
      : null
  return (
    <PrintFrame
      input={input}
      backTo={offerId ? `/portal/offers/${offerId}` : '/portal/offers'}
      backLabel={t('offers.print.backPortal')}
      missing={!isLoading && !input}
    />
  )
}
