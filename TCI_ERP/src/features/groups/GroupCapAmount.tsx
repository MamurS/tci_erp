/** A group limit as the underwriter set it, then what the database compares.
 *
 * The cap is recorded in its own currency (800,000 USD) but enforced in UZS at
 * the latest rate (tci.v_group_limit_status.limit_uzs). Showing only one of
 * the two made «Группы» say 800,000 USD and «Мониторинг» 9.62 млрд UZS for the
 * same limit; every screen now shows the original first and the UZS
 * equivalent after it. A cap with no rate today says so instead of a number.
 */

import { useTranslation } from 'react-i18next'

import { EM_DASH, formatAmount, formatCompact } from '../../lib/format'

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function GroupCapAmount({
  amount,
  currency,
  amountUzs,
  stacked = false,
}: {
  amount: number | string | null | undefined
  currency: string | null | undefined
  /** limit_uzs from the view: null when the currency has no rate today,
   * undefined while it is not known yet (nothing is said then). */
  amountUzs?: number | string | null
  /** Put the UZS equivalent on a second, smaller line (table cells). */
  stacked?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const original = toNumber(amount)
  if (original === null || !currency) return <span className="text-slate-400">{EM_DASH}</span>

  const uzs = toNumber(amountUzs)
  const main = `${formatAmount(original, locale)} ${currency}`
  const equivalent =
    currency === 'UZS' || amountUzs === undefined ? null : uzs === null ? (
      <span className="text-warn-500">{t('groups.exposure.rateMissingShort')}</span>
    ) : (
      <span className="text-slate-500">≈ {formatCompact(uzs, locale)} UZS</span>
    )

  if (stacked) {
    return (
      <span className="inline-flex flex-col items-end whitespace-nowrap">
        <span>{main}</span>
        {equivalent && <span className="text-[0.75rem]">{equivalent}</span>}
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap">
      {main}
      {equivalent && <span className="ml-1.5 font-normal">{equivalent}</span>}
    </span>
  )
}
