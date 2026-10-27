/**
 * The offer on paper: the whole document at full size in its sandboxed frame,
 * under a toolbar with «Печать / PDF». The PDF is the browser's own «Save as
 * PDF» of the frame — the document carries its A4 page rules (`@page`, one
 * page per sheet, exact colours) — so nothing leaves our infrastructure.
 * ?auto=1 opens the print dialog once the document (and its fonts) is in;
 * ?v=N shows that version (staff only — the portal shows what was published).
 */

import { useEffect, useMemo, useRef } from 'react'
import { usePrintScale } from '../account/uiScaleApi'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'

import { EmptyState, Spinner } from '../../components/ui'
import { useCountries } from '../entities/api'
import { useClientOffers, useOffer, useOfferVersion } from './api'
import { clientRenderInput, staffRenderInput, type OfferRenderInput } from './kp/input'
import { OFFER_PAGE_GAP, OFFER_PAGE_HEIGHT, OFFER_PAGE_WIDTH } from './kp/render'
import { OfferFrame } from './OfferFrame'
import { printOfferFrame } from './printOfferFrame'
import { useOfferDocument } from './useOfferDocument'

function PrintView({
  input,
  backTo,
  backLabel,
  missing,
}: {
  input: OfferRenderInput | null
  backTo: string
  backLabel: string
  missing: boolean
}) {
  // A4 is laid out at 100 %, whatever size the screen uses (0076).
  usePrintScale()
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const doc = useOfferDocument(input, 0)
  const frame = useRef<HTMLIFrameElement>(null)
  const printed = useRef(false)
  const auto = params.get('auto') === '1'

  useEffect(() => {
    if (doc) document.title = doc.title
  }, [doc])

  const stack = doc ? doc.pageCount * OFFER_PAGE_HEIGHT + (doc.pageCount - 1) * OFFER_PAGE_GAP : 0

  return (
    <div className="min-h-screen bg-slate-200">
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-accent-600 px-4 py-2 text-white">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-small text-white/85 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
        <div className="flex-1 truncate text-center text-body font-medium">{doc?.title ?? ''}</div>
        <span className="hidden text-small text-white/80 md:inline">{t('offers.pdfHint')}</span>
        <button
          type="button"
          onClick={() => void printOfferFrame(frame.current)}
          disabled={!doc}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-small font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60"
        >
          <Printer className="size-4" />
          {t('offers.print.print')}
        </button>
      </div>
      <div className="flex justify-center px-4 py-6">
        {missing ? (
          <EmptyState title={t('offers.print.missing')} hint={t('offers.print.missingHint')} />
        ) : !doc ? (
          <Spinner />
        ) : (
          <OfferFrame
            ref={frame}
            title={doc.title}
            html={doc.html}
            className="block border-0"
            style={{ width: OFFER_PAGE_WIDTH, height: stack }}
            onLoad={() => {
              if (!auto || printed.current) return
              printed.current = true
              void printOfferFrame(frame.current)
            }}
          />
        )}
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
  const { data: countries, isLoading: countriesLoading } = useCountries()
  const input = useMemo(
    () => (offer && version && !countriesLoading ? staffRenderInput(offer, version, countries) : null),
    [offer, version, countries, countriesLoading],
  )

  return (
    <PrintView
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
  const { data: countries, isLoading: countriesLoading } = useCountries()
  const offer = offers?.find((o) => o.id === offerId) ?? null
  const input = useMemo(
    () => (offer && !countriesLoading ? clientRenderInput(offer, countries) : null),
    [offer, countries, countriesLoading],
  )
  return (
    <PrintView
      input={input}
      backTo={offerId ? `/portal/offers/${offerId}` : '/portal/offers'}
      backLabel={t('offers.print.backPortal')}
      missing={!isLoading && (!offer || !offer.data)}
    />
  )
}
