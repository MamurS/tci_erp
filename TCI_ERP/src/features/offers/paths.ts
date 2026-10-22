/** Routes of the offer screens (App.tsx registers them). The staff screens
 * live under /requests so the section's role guard covers them. */

export const offerEditPath = (offerId: string) => `/requests/offers/${offerId}/edit`

export const offerPrintPath = (offerId: string, versionNo?: number | null, auto = false) => {
  const q = new URLSearchParams()
  if (versionNo) q.set('v', String(versionNo))
  if (auto) q.set('auto', '1')
  const s = q.toString()
  return `/requests/offers/${offerId}/print${s ? `?${s}` : ''}`
}

export const portalOffersPath = '/portal/offers'
export const portalOfferPath = (offerId: string) => `/portal/offers/${offerId}`
export const portalOfferPrintPath = (offerId: string, auto = false) =>
  `/portal/offers/${offerId}/print${auto ? '?auto=1' : ''}`
